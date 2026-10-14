#!/usr/bin/env python3
"""Exercise recoverable moves only inside disposable temporary homes."""
import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('executor', Path(__file__).with_name('execute-approved-cleanup.py'))
executor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(executor)


class Moves(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='cleanup-skill-test-')
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name).resolve()
        self.root = self.home / 'review'
        self.root.mkdir(); (self.home / '.Trash').mkdir(); (self.root / 'approvals').mkdir()
        self.write('session.json', {'id': 'test-session', 'home': str(self.home)})
        self.real_run = subprocess.run

    def write(self, name, value):
        (self.root / name).write_text(json.dumps(value))

    def approve(self, paths, kind='generated', verification=None, choice='shortlist', note=''):
        self.write('review-state.json', {'choices': {'item': choice}, 'notes': {'item': note}})
        self.write('approvals/test-approval.json', {'id': 'test-approval', 'status': 'approved', 'entries': [{'id': 'item', 'choice': choice, 'paths': list(map(str, paths)), 'kind': kind, 'note': note, 'verification': verification or {'type': 'generated-file', 'reason': 'Test fixture'}}]})

    def run_move(self, open_path=None):
        def run(argv, **kwargs):
            if Path(argv[0]).name == 'lsof':
                return subprocess.CompletedProcess(argv, 0, 'n' + str(open_path) if open_path else '', '')
            return self.real_run(argv, **kwargs)
        with patch.object(executor.subprocess, 'run', side_effect=run), contextlib.redirect_stdout(io.StringIO()):
            return executor.execute(self.root, 'test-approval')

    def repository(self):
        repo = self.home / 'repo'; repo.mkdir()
        subprocess.run(['git', 'init', '-q', str(repo)], check=True)
        (repo / 'source.txt').write_text('keep the source')
        (repo / '.gitignore').write_text('node_modules/\n')
        executor.git(repo, 'add', '.')
        executor.git(repo, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'Fixture')
        return repo


    def test_scan_skips_dependency_contents_cloud_and_trash(self):
        scanner_spec = importlib.util.spec_from_file_location('scanner', Path(__file__).with_name('cleanup.py'))
        scanner = importlib.util.module_from_spec(scanner_spec); scanner_spec.loader.exec_module(scanner)
        for folder in ['project/node_modules/package', 'Library/CloudStorage/provider', '.Trash/old']:
            directory = self.home / folder; directory.mkdir(parents=True, exist_ok=True)
            (directory / 'private.md').write_text('fixture')
        (self.home / 'guide.md').write_text('guide')
        with contextlib.redirect_stdout(io.StringIO()):
            scanner.scan(SimpleNamespace(home=self.home, paths=[], exclude=[self.root], output=self.root / 'inventory.json'))
        records = json.loads((self.root / 'inventory.json').read_text())['candidates']
        paths = {r['path'] for r in records}
        self.assertIn(str(self.home / 'guide.md'), paths)
        self.assertIn(str(self.home / 'project/node_modules'), paths)
        self.assertFalse(any('private.md' in p for p in paths))

    def test_move_verifies_identity_and_blocks_replay(self):
        source = self.home / 'build.log'; source.write_text('generated')
        inode = source.stat().st_ino
        self.approve([source])
        result = self.run_move()
        self.assertTrue(result['complete'])
        self.assertFalse(source.exists())
        destination = Path(result['entries'][0]['destination'])
        self.assertEqual(destination.stat().st_ino, inode)
        self.assertTrue(Path(result['restoreFile']).exists())
        with self.assertRaisesRegex(ValueError, 'execution journal'): self.run_move()

    def test_dependencies_keep_source_and_git(self):
        repo = self.repository(); deps = repo / 'node_modules'; deps.mkdir()
        (deps / 'package.js').write_text('installed')
        head = executor.git(repo, 'rev-parse', 'HEAD')
        self.approve([deps], kind='repo', choice='dependenciesOnly')
        self.run_move()
        self.assertTrue((repo / 'source.txt').exists())
        self.assertEqual(executor.git(repo, 'rev-parse', 'HEAD'), head)
        self.assertFalse(deps.exists())

    def test_note_blocks_and_records_reason(self):
        source = self.home / 'build.log'; source.touch()
        self.approve([source], note='Keep until the migration is done')
        with self.assertRaisesRegex(ValueError, 'Saved instructions'): self.run_move()
        record = json.loads(next(self.root.glob('trash-move-*.json')).read_text())
        self.assertEqual(record['entries'][0]['status'], 'blocked')
        self.assertFalse(record['complete']); self.assertTrue(source.exists())

    def test_open_file_blocks(self):
        source = self.home / 'build.log'; source.touch(); self.approve([source])
        with self.assertRaisesRegex(ValueError, 'open files'): self.run_move(open_path=source)
        self.assertTrue(source.exists())

    def test_duplicate_keeps_verified_copy(self):
        source = self.home / 'copy.txt'; keep = self.home / 'original.txt'
        source.write_bytes(b'same'); keep.write_bytes(b'same')
        self.approve([source], verification={'type': 'identical-files', 'retain': str(keep), 'sha256': executor.sha(keep)})
        self.run_move(); self.assertEqual(keep.read_bytes(), b'same'); self.assertFalse(source.exists())

    def test_changed_duplicate_blocks(self):
        source = self.home / 'copy.txt'; keep = self.home / 'original.txt'
        source.write_bytes(b'different'); keep.write_bytes(b'same')
        self.approve([source], verification={'type': 'identical-files', 'retain': str(keep), 'sha256': executor.sha(keep)})
        with self.assertRaisesRegex(ValueError, 'Duplicate contents changed'): self.run_move()
        self.assertTrue(source.exists())

    def test_symlink_ancestor_blocks(self):
        actual = self.home / 'actual'; actual.mkdir(); (actual / 'log').touch()
        link = self.home / 'linked'; link.symlink_to(actual)
        self.approve([link / 'log'])
        with self.assertRaisesRegex(ValueError, 'redirected'): self.run_move()
        self.assertTrue((actual / 'log').exists())

    def test_worktree_move_preserves_registration_and_restore(self):
        repo = self.repository(); worktree = self.home / 'worktree'
        executor.git(repo, 'worktree', 'add', '-b', 'fixture-branch', str(worktree))
        proof = {'type': 'git-review', 'head': executor.git(worktree, 'rev-parse', 'HEAD'), 'statusSha256': hashlib.sha256(executor.git_status(worktree).encode()).hexdigest()}
        self.approve([worktree], kind='worktree', verification=proof)
        result = self.run_move(); dest = result['entries'][0]['destination']
        self.assertIn(dest, executor.git(repo, 'worktree', 'list', '--porcelain'))
        self.assertTrue((repo / 'source.txt').exists())
        restore = Path(result['restoreFile']).read_text()
        self.assertIn('worktree move', restore)
        executor.git(repo, 'worktree', 'move', dest, str(worktree))
        self.assertTrue((worktree / 'source.txt').exists())

    def test_main_repository_with_worktrees_blocks(self):
        repo = self.repository(); worktree = self.home / 'worktree'
        executor.git(repo, 'worktree', 'add', '-b', 'fixture-branch', str(worktree))
        proof = {'type': 'git-review', 'head': executor.git(repo, 'rev-parse', 'HEAD'), 'statusSha256': hashlib.sha256(executor.git_status(repo).encode()).hexdigest()}
        self.approve([repo], kind='repo', verification=proof)
        with self.assertRaisesRegex(ValueError, 'owns linked worktrees'): self.run_move()
        self.assertTrue(repo.exists()); self.assertTrue(worktree.exists())


if __name__ == '__main__': unittest.main()
