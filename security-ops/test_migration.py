import hashlib
import importlib.util
from pathlib import Path
import sqlite3
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('migration', Path(__file__).with_name('prepare-migration.py'))
migration = importlib.util.module_from_spec(spec)
spec.loader.exec_module(migration)

class MigrationTests(unittest.TestCase):
    def test_isolation_and_rejection(self):
        with tempfile.TemporaryDirectory() as folder:
            source, target, output = [Path(folder) / name for name in ['source.db','target.db','output.db']]
            for file, uid in [(source,'old'),(target,'new')]:
                with sqlite3.connect(file) as db:
                    db.executescript('CREATE TABLE user(id TEXT PRIMARY KEY,email TEXT,email_verified INTEGER); CREATE TABLE account(user_id TEXT,provider_id TEXT); CREATE TABLE session(token TEXT);')
                    db.execute('INSERT INTO user VALUES(?,?,1)',(uid,'owner@example.invalid'))
                    db.execute('INSERT INTO account VALUES(?,?)',(uid,'google' if uid == 'new' else 'runable'))
                    db.execute('INSERT INTO session VALUES(?)',('must-not-migrate',))
                    for table in migration.TABLES:
                        db.execute(f'CREATE TABLE {table}(id TEXT PRIMARY KEY,user_id TEXT, ciphertext TEXT, revoked_at_ms INTEGER)')
                        if uid == 'old': db.execute(f'INSERT INTO {table} VALUES(?,?,?,NULL)',(table,uid,'encrypted-only'))
            before = [hashlib.sha256(p.read_bytes()).digest() for p in [source,target]]
            counts = migration.prepare(source,target,output,'old','new')
            self.assertEqual(counts['record'],1)
            self.assertEqual(before,[hashlib.sha256(p.read_bytes()).digest() for p in [source,target]])
            self.assertEqual(output.stat().st_mode & 0o777,0o600)
            with sqlite3.connect(output) as db:
                self.assertEqual(db.execute('SELECT count(*) FROM session').fetchone()[0],0)
                self.assertEqual(db.execute('SELECT user_id,ciphertext FROM record').fetchone(),('new','encrypted-only'))
                self.assertIsNotNone(db.execute('SELECT revoked_at_ms FROM device').fetchone()[0])
                self.assertEqual(db.execute('SELECT provider_id FROM account').fetchone()[0],'google')
            with self.assertRaises(ValueError): migration.prepare(source,target,output,'old','new')
            with sqlite3.connect(target) as db: db.execute('UPDATE user SET email=?',('another@example.invalid',))
            with self.assertRaises(ValueError): migration.prepare(source,target,Path(folder)/'bad.db','old','new')
            self.assertFalse((Path(folder)/'bad.db').exists())
