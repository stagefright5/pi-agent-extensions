#!/usr/bin/env python3
"""Create local cleanup sessions, collect metadata, render reviews, and run the bridge."""
import argparse
import datetime as dt
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import uuid

SKILL = Path(__file__).resolve().parents[1]


def write_json(path, value):
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value, indent=2) + '\n')
    temporary.chmod(0o600)
    temporary.replace(path)


def load(path):
    return json.loads(path.read_text())


def init(args):
    root = args.root.expanduser().absolute()
    root.mkdir(mode=0o700, parents=True, exist_ok=False)
    shutil.copytree(SKILL / 'assets/app', root, dirs_exist_ok=True)
    shutil.copy2(SKILL / 'scripts/execute-approved-cleanup.py', root)
    write_json(root / 'session.json', {
        'id': str(uuid.uuid4()), 'home': str(args.home.expanduser().resolve()),
        'createdAt': dt.datetime.now(dt.timezone.utc).isoformat(),
    })
    write_json(root / 'review-state.json', {'choices': {}, 'notes': {}, 'updatedAt': None})
    write_json(root / 'review-data.json', {k: [] for k in ['repos', 'dependencies', 'docs', 'appdata', 'shortlist']})
    print(root)


def scan(args):
    """Metadata only. Never read file contents or follow symlinks."""
    home = args.home.expanduser().resolve()
    excluded = [home / '.Trash', home / 'Library/CloudStorage', home / 'Library/Mobile Documents']
    excluded += [p.expanduser().absolute() for p in args.exclude]
    rows, errors, skipped = [], [], []
    roots = args.paths or [home]
    seen = set()
    for start in roots:
        start = start.expanduser().absolute()
        if not start.is_relative_to(home) or start.is_symlink() or start.resolve() != start:
            raise ValueError('Scan roots must be inside the selected home folder')
        if any(start == p or start.is_relative_to(p) for p in excluded): continue
        for current, dirs, files in os.walk(start, followlinks=False, onerror=lambda e: errors.append(str(e))):
            here = Path(current)
            if here in seen or any(here == p or here.is_relative_to(p) for p in excluded):
                dirs[:] = []
                continue
            seen.add(here)
            try:
                # SF_DATALESS on macOS indicates a cloud placeholder. Do not descend.
                if getattr(here.stat(), 'st_flags', 0) & 0x40000000:
                    skipped.append(str(here)); dirs[:] = []; continue
                rows.append({'kind': 'directory', 'path': str(here)})
                if '.git' in dirs or '.git' in files:
                    rows.append({'kind': 'worktree' if '.git' in files else 'repo', 'path': str(here)})
                if here.name in {'node_modules', 'target', '.nx', '.cache'}:
                    rows.append({'kind': 'dependencies' if here.name == 'node_modules' else 'generated-candidate', 'path': str(here)})
                    dirs[:] = []; continue
                kept = []
                for name in dirs:
                    p = here / name
                    if name == '.git' or p.is_symlink(): continue
                    if any(p == excluded_path or p.is_relative_to(excluded_path) for excluded_path in excluded): continue
                    if getattr(p.stat(), 'st_flags', 0) & 0x40000000:
                        skipped.append(str(p)); continue
                    kept.append(name)
                dirs[:] = kept
                for name in files:
                    p = here / name
                    if p.is_symlink(): continue
                    if p.suffix.lower() not in {'.md', '.mdx', '.txt', '.pdf', '.docx', '.xlsx', '.log'}: continue
                    st = p.stat()
                    if getattr(st, 'st_flags', 0) & 0x40000000:
                        skipped.append(str(p)); continue
                    rows.append({'kind': 'document', 'path': str(p), 'bytes': st.st_size, 'mtime': st.st_mtime})
            except OSError as e:
                errors.append(str(e)); dirs[:] = []
    write_json(args.output.expanduser(), {'home': str(home), 'scannedAt': dt.datetime.now(dt.timezone.utc).isoformat(), 'candidates': rows, 'errors': errors, 'cloudPlaceholdersSkipped': skipped, 'excluded': list(map(str, excluded))})
    print(f'{len(rows)} metadata records, {len(errors)} access errors. No deletion recommendations were inferred.')


def render(args):
    root = args.root.expanduser().resolve()
    session = load(root / 'session.json')
    selection = load(args.input)
    items = selection['items']
    ids = set()
    for item in items:
        if not isinstance(item.get('id'), str) or item['id'] in ids:
            raise ValueError('Each item needs a unique, stable string ID')
        ids.add(item['id'])
        for key in ['title', 'why', 'check', 'kind']:
            if not isinstance(item.get(key), str) or not item[key].strip():
                raise ValueError(f'{item["id"]}: provide {key}')
        if not isinstance(item.get('bytes'), (int, float)) or item['bytes'] < 0:
            raise ValueError('Provide the measured size in bytes')
        for paths in [item.get('paths'), item.get('dependencies', {}).get('paths', [])]:
            if not isinstance(paths, list): raise ValueError('Paths must be arrays')
            for raw in paths:
                if not isinstance(raw, str): raise ValueError('Paths must be strings')
                full = Path(session['home']) / raw[2:] if raw.startswith('~/') else Path(raw)
                if not full.is_absolute() or '..' in full.parts or not full.is_relative_to(Path(session['home'])):
                    raise ValueError('Review paths must be absolute or ~/ paths within the configured home')
        if not item['paths']: raise ValueError('An item must have exact paths')
        deps = item.get('dependencies')
        if deps:
            if not isinstance(deps.get('bytes'), (int, float)): raise ValueError('Measure dependency bytes separately')
            for raw in deps['paths']:
                if Path(raw).name != 'node_modules': raise ValueError('Dependency-only choices must target node_modules')
    old = {r['id']: r for group in load(root / 'review-data.json').values() for r in group}
    for item in items:
        if item['id'] in old:
            for key in ['paths', 'dependencies', 'verification', 'kind']:
                if item.get(key) != old[item['id']].get(key):
                    raise ValueError(f'{item["id"]}: target scope changed. Use a new item ID and obtain a new review.')
    batches = selection.get('batches') or [{'id': 'batch-' + str(i // 5 + 1), 'name': 'Batch ' + str(i // 5 + 1), 'ids': [r['id'] for r in items[i:i+5]]} for i in range(0, len(items), 5)]
    if not batches: raise ValueError('Curate at least one item before rendering')
    lookup = {r['id']: r for r in items}
    rendered = []
    for batch in batches:
        if not batch['ids']: raise ValueError('Empty batch')
        rendered.append({'id': batch['id'], 'name': batch['name'], 'label': batch['name'], 'items': [lookup[i] for i in batch['ids']]})
    data = {k: [] for k in ['repos', 'dependencies', 'docs', 'appdata', 'shortlist']}
    # Retain earlier item definitions so saved notes and approvals remain interpretable.
    data['shortlist'] = list({**old, **lookup}.values())
    completed = {}
    for journal in root.glob('trash-move-*.json'):
        record = load(journal)
        if record.get('complete'):
            for row in record['entries']:
                if row.get('status') == 'verified': completed[row['itemId']] = True
    template = (root / 'index.template.html').read_text()
    for marker, value in {'__DATA__': data, '__SESSION__': session, '__BATCHES__': rendered, '__COMPLETED__': completed}.items():
        template = template.replace(marker, json.dumps(value).replace('<', '\\u003c'))
    write_json(root / 'review-data.json', data)
    (root / 'index.html').write_text(template)
    (root / 'index.html').chmod(0o600)
    print(f'{root / "index.html"}\nRestart a running bridge after changing review data, then reload the page.')


def serve(args):
    root = args.root.expanduser().resolve()
    if not (root / 'index.html').exists(): raise ValueError('Render a curated batch first')
    if not shutil.which('node') or not shutil.which('npm'): raise ValueError('Node.js and npm must be on PATH')
    bridge = root / 'bridge'
    if not (bridge / 'node_modules/ws').exists():
        subprocess.run(['npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], cwd=bridge, check=True)
    port = args.port
    if port == 0:
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', 0)); port = listener.getsockname()[1]
    env = dict(os.environ, CLEANUP_ROOT=str(root), CLEANUP_PORT=str(port), CLEANUP_HOST=args.host)
    if args.thread: env['CODEX_THREAD_ID'] = args.thread
    if args.socket: env['CODEX_SOCKET'] = str(args.socket.expanduser())
    config = root / 'bridge/state/connection.json'
    if config.exists():
        old = load(config)
        if old['host'] != args.host or args.thread and old.get('threadId') != args.thread:
            raise ValueError('This session is bound to another host or conversation. Create a fresh session.')
    os.execvpe('node', ['node', str(bridge / 'server.mjs')], env)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    p = commands.add_parser('init'); p.add_argument('root', type=Path); p.add_argument('--home', type=Path, default=Path.home()); p.set_defaults(run=init)
    p = commands.add_parser('scan'); p.add_argument('paths', nargs='*', type=Path); p.add_argument('--home', type=Path, default=Path.home()); p.add_argument('--exclude', action='append', type=Path, default=[]); p.add_argument('--output', type=Path, required=True); p.set_defaults(run=scan)
    p = commands.add_parser('render'); p.add_argument('root', type=Path); p.add_argument('--input', required=True, type=Path); p.set_defaults(run=render)
    p = commands.add_parser('serve'); p.add_argument('root', type=Path); p.add_argument('--host', choices=['codex', 'pi'], required=True); p.add_argument('--thread'); p.add_argument('--socket', type=Path); p.add_argument('--port', type=int, default=0); p.set_defaults(run=serve)
    args = parser.parse_args()
    try: args.run(args)
    except (ValueError, OSError, KeyError) as error: parser.exit(1, f'{error}\n')


if __name__ == '__main__':
    main()
