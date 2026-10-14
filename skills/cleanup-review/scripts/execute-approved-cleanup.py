#!/usr/bin/env python3
"""Move an approved local selection to Trash and record each verified move."""
import argparse
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess


def require(condition, message):
    if not condition:
        raise ValueError(message)


def read(path):
    return json.loads(path.read_text())


def sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def git(parent, *args):
    return subprocess.run(['git', '--no-optional-locks', '-C', str(parent), *args], capture_output=True, text=True, check=True, timeout=60).stdout.rstrip('\n')


def git_status(repo):
    return git(repo, 'status', '--porcelain=v1', '--untracked-files=all', '--ignored')


def execute(root, approval_id):
    root = root.resolve()
    require(re.fullmatch(r'[a-zA-Z0-9_-]{8,100}', approval_id), 'Invalid approval ID')
    # One executor per session. An interrupted run retains its journal and cannot replay.
    with (root / '.execution.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return execute_locked(root, approval_id)


def execute_locked(root, approval_id):
    session = read(root / 'session.json')
    home = Path(session['home']).resolve()
    trash = home / '.Trash'
    approval = read(root / 'approvals' / (approval_id + '.json'))
    require(approval.get('id') == approval_id and approval.get('status') == 'approved', 'Approval must be delivered before execution')
    require(not any(read(p).get('approvalId') == approval_id for p in root.glob('trash-move-*.json')), 'This approval has an execution journal. Inspect it before any recovery; do not replay it.')
    stamp = dt.datetime.now().strftime('%Y-%m-%d-%H%M%S')
    batch = trash / ('cleanup-' + stamp + '-' + approval_id)
    journal = root / ('trash-move-' + stamp + '-' + approval_id + '.json')
    expand = lambda raw: home / raw[2:] if raw.startswith('~/') else Path(raw)
    entries = [dict(source=str(expand(raw)), status='pending', itemId=row['id'], choice=row['choice'], kind=row.get('kind'), verification=row.get('verification') or {}) for row in approval['entries'] for raw in row['paths']]
    manifest = dict(approvalId=approval_id, createdAt=dt.datetime.now(dt.timezone.utc).isoformat(), batch=str(batch), restoreFile=str(batch / 'RESTORE.txt'), entries=entries, complete=False)
    current = None

    def save():
        for destination in [journal] + ([batch / 'restore-manifest.json'] if batch.exists() else []):
            temporary = destination.with_suffix('.tmp')
            temporary.write_text(json.dumps(manifest, indent=2) + '\n')
            temporary.chmod(0o600)
            os.replace(temporary, destination)

    def valid_path(source):
        require(source.is_absolute() and source != home and source.is_relative_to(home), 'Path must be below the configured home')
        require(not source.is_relative_to(trash) and not source.is_relative_to(root) and not root.is_relative_to(source), 'Cannot move Trash or the review session')
        require('.git' not in source.relative_to(home).parts, 'Do not move Git metadata separately')
        require(not source.is_symlink() and source.resolve() == source and source.exists(), 'Missing source or redirected ancestor')
        require(not getattr(source.stat(), 'st_flags', 0) & 0x40000000, 'Cloud placeholder requires separate review')

    def check_retained(entry):
        verification = entry['verification']
        retained = expand(verification['retain'])
        valid_path(retained)
        require(retained.is_file() and all(not retained.is_relative_to(Path(e['source'])) for e in entries), 'The retained copy must be outside every move')
        require(sha(retained) == verification['sha256'], 'Retained copy changed')
        return retained

    try:
        save()
        state = read(root / 'review-state.json')
        for row in approval['entries']:
            require(state['choices'].get(row['id']) == row['choice'], 'Choice changed after approval')
            require(state.get('notes', {}).get(row['id'], '') == row.get('note', ''), 'Note changed after approval')
            require(not row.get('note'), 'Saved instructions require agent review. Do not clear them to bypass this check.')
        require(entries, 'Approval has no paths')
        require(trash.is_dir() and not trash.is_symlink() and trash.resolve() == trash, 'Expected a local ~/.Trash directory')
        require(not os.path.lexists(batch), 'Trash destination already exists')
        sources = []
        for entry in entries:
            current = entry
            source = Path(entry['source'])
            valid_path(source)
            require(entry['choice'] != 'dependenciesOnly' or source.name == 'node_modules', 'Dependency-only approval cannot move source')
            require(not any(source.is_relative_to(p) or p.is_relative_to(source) for p in sources), 'Overlapping selections')
            sources.append(source)
            st = source.stat()
            require(st.st_dev == trash.stat().st_dev, 'Cross-volume moves require separate handling')
            entry.update(destination=str(batch / source.relative_to(home)), inode=st.st_ino, device=st.st_dev)
            verification = entry['verification']
            if source.name == 'node_modules':
                require(source.is_dir(), 'Expected a dependency directory')
                repo = Path(git(source.parent, 'rev-parse', '--show-toplevel'))
                require(not git(repo, 'ls-files', '--', str(source)), 'Tracked dependency contents need separate review')
                entry.update(operation='rename', repo=str(repo), head=git(repo, 'rev-parse', 'HEAD'))
            elif verification.get('type') == 'identical-files':
                require(source.is_file(), 'Expected a duplicate file')
                check_retained(entry)
                require(sha(source) == verification['sha256'], 'Duplicate contents changed')
                entry['operation'] = 'rename'
            elif entry['kind'] in {'repo', 'worktree'} and verification.get('type') == 'git-review':
                require(source.is_dir() and Path(git(source, 'rev-parse', '--show-toplevel')).resolve() == source, 'Expected the repository root')
                head = git(source, 'rev-parse', 'HEAD')
                status = git_status(source)
                require(head == verification.get('head') and hashlib.sha256(status.encode()).hexdigest() == verification.get('statusSha256'), 'Git state changed since the agent reviewed it')
                common = Path(git(source, 'rev-parse', '--path-format=absolute', '--git-common-dir')).resolve()
                gitdir = Path(git(source, 'rev-parse', '--absolute-git-dir')).resolve()
                require(not (gitdir / 'locked').exists() and not (gitdir / 'index.lock').exists(), 'Git worktree or index is locked')
                if common != gitdir:
                    require(not common.is_relative_to(source), 'Expected retained shared Git metadata')
                    require(all(not common.is_relative_to(Path(e['source'])) for e in entries), 'A selected repo contains this worktree\'s shared metadata')
                    entry.update(operation='worktree', commonDir=str(common))
                else:
                    require(gitdir == source / '.git', 'External Git metadata needs agent handling')
                    require(len([line for line in git(source, 'worktree', 'list', '--porcelain').splitlines() if line.startswith('worktree ')]) == 1, 'Main repository still owns linked worktrees')
                    entry['operation'] = 'rename'
                entry.update(head=head, gitStatus=status, isRepository=True)
            elif verification.get('type') in {'generated-directory', 'generated-file'}:
                require(bool(verification.get('reason')), 'Explain why this output can be recreated')
                require(source.is_dir() if verification['type'] == 'generated-directory' else source.is_file(), 'Generated output type changed')
                if source.is_dir():
                    for directory, dirs, files in os.walk(source, followlinks=False):
                        require('.git' not in dirs and '.git' not in files, 'Generated output contains a repository')
                probe = subprocess.run(['git', '-C', str(source.parent), 'rev-parse', '--show-toplevel'], capture_output=True, text=True)
                if probe.returncode == 0:
                    require(not git(probe.stdout.strip(), 'ls-files', '--', str(source)), 'Tracked output requires separate review')
                entry['operation'] = 'rename'
            else:
                raise ValueError('This scope needs agent inspection and a documented move procedure')
            entry['status'] = 'checked'
        current = None
        lsof = shutil.which('lsof') or '/usr/sbin/lsof'
        opened = subprocess.run([lsof, '-nP', '-Fn'], capture_output=True, text=True, timeout=60)
        require(opened.returncode == 0, 'Could not check open files with lsof')
        for entry in entries:
            current = entry
            require(not any(line.startswith('n') and (line[1:] == entry['source'] or line[1:].startswith(entry['source'] + '/')) for line in opened.stdout.splitlines()), 'A selected path has open files. Stop its process before another review.')
        current = None
        require(read(root / 'review-state.json') == state, 'Review changed during checks')
        batch.mkdir(mode=0o700)
        restore = ['Restore this cleanup batch', '', 'Stop related builds before restoring. Check the journal first: only restore entries that actually moved.', 'Do not merge into recreated directories. Inspect each command before running it.', '']
        for entry in entries:
            src, dst = shlex.quote(entry['source']), shlex.quote(entry['destination'])
            command = ('git --git-dir=' + shlex.quote(entry['commonDir']) + ' worktree move ' + dst + ' ' + src) if entry['operation'] == 'worktree' else 'mv -n ' + dst + ' ' + src
            restore.extend([entry['source'], 'test ! -e ' + src + ' && test ! -L ' + src + ' && ' + command, ''])
        for file in [batch / 'RESTORE.txt', root / ('restore-' + approval_id + '.txt')]:
            file.write_text('\n'.join(restore) + '\n'); file.chmod(0o600)
        save()
        for entry in entries:
            current = entry
            require(read(root / 'review-state.json') == state, 'Review changed during execution')
            source, dest = Path(entry['source']), Path(entry['destination'])
            valid_path(source)
            st = source.lstat()
            require((st.st_dev, st.st_ino) == (entry['device'], entry['inode']), 'Source identity changed')
            require(not os.path.lexists(dest), 'Destination exists')
            if entry.get('isRepository'):
                require(git(source, 'rev-parse', 'HEAD') == entry['head'] and git_status(source) == entry['gitStatus'], 'Git state changed during checks')
            if entry['verification'].get('type') == 'identical-files':
                check_retained(entry)
                require(sha(source) == entry['verification']['sha256'], 'Duplicate changed before moving')
            dest.parent.mkdir(parents=True, exist_ok=True)
            entry['status'] = 'moving'; save()
            if entry['operation'] == 'worktree':
                subprocess.run(['git', '--git-dir=' + entry['commonDir'], 'worktree', 'move', str(source), str(dest)], capture_output=True, text=True, check=True, timeout=60)
            else:
                os.rename(source, dest)
            entry['status'] = 'moved'; save()
            st = dest.stat()
            require(not os.path.lexists(source) and (st.st_dev, st.st_ino) == (entry['device'], entry['inode']), 'Move identity verification failed')
            if entry.get('repo'):
                require(git(entry['repo'], 'rev-parse', 'HEAD') == entry['head'], 'Parent repository HEAD changed')
            if entry.get('isRepository'):
                require(Path(git(dest, 'rev-parse', '--show-toplevel')).resolve() == dest and git(dest, 'rev-parse', 'HEAD') == entry['head'] and git_status(dest) == entry['gitStatus'], 'Moved repository failed Git verification')
            if entry['verification'].get('type') == 'identical-files':
                require(sha(dest) == entry['verification']['sha256'], 'Moved duplicate failed hash verification')
                check_retained(entry)
            entry['status'] = 'verified'; save()
            print('Verified:', source, flush=True)
        manifest['complete'] = True
        manifest['completedAt'] = dt.datetime.now(dt.timezone.utc).isoformat()
        save()
        print(json.dumps({'complete': True, 'batch': str(batch), 'journal': str(journal)}))
    except Exception as error:
        message = str(error) or type(error).__name__
        for entry in entries:
            if entry['status'] != 'verified':
                entry['error'] = message if entry is current or current is None else 'Stopped after another path failed its checks'
                if entry['status'] not in {'moving', 'moved'}: entry['status'] = 'blocked'
        manifest['error'] = message
        save()
        raise
    return manifest


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parent)
    parser.add_argument('--approval', required=True)
    args = parser.parse_args()
    execute(args.root, args.approval)
