#!/usr/bin/env python3
"""Prepare a NEW SQLite copy from two local snapshots. Never writes either input.
Target snapshot must contain a freshly authenticated, verified Google user and no vault.
Does not migrate browser IndexedDB/recordings. Output contains sensitive metadata.
"""
import argparse
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import time

TABLES = ("vault", "record", "device", "audit_event", "login_event")

def readonly(path):
    return sqlite3.connect(Path(path).resolve().as_uri() + "?mode=ro", uri=True)

def prepare(source, target, output, source_user, target_user):
    output = Path(output).resolve()
    if output.exists() or output in (Path(source).resolve(), Path(target).resolve()):
        raise ValueError("Output must be a new file; inputs are never overwritten")
    temp = None
    with readonly(source) as src, readonly(target) as dst:
        src.row_factory = sqlite3.Row
        old = src.execute('SELECT email FROM user WHERE id=?', (source_user,)).fetchone()
        new = dst.execute('SELECT email,email_verified FROM user WHERE id=?', (target_user,)).fetchone()
        if not old or not new or not new[1] or old[0].strip().lower() != new[0].strip().lower():
            raise ValueError("Source and verified destination owner must have the same email")
        if dst.execute('SELECT count(*) FROM user').fetchone()[0] != 1:
            raise ValueError("Use an isolated single-owner destination snapshot")
        if not dst.execute('SELECT 1 FROM account WHERE user_id=? AND provider_id=?', (target_user, 'google')).fetchone():
            raise ValueError("Destination must already have its own Google login")
        for table in TABLES:
            if dst.execute(f'SELECT 1 FROM "{table}" WHERE user_id=? LIMIT 1', (target_user,)).fetchone():
                raise ValueError("Destination must be empty before migration: " + table)
        if src.execute('SELECT count(*) FROM vault WHERE user_id=?', (source_user,)).fetchone()[0] != 1:
            raise ValueError("Source must contain exactly one owner vault")
        fd, temp = tempfile.mkstemp(prefix='.cockpit-migration-', dir=output.parent)
        os.close(fd)  # mkstemp creates mode 0600
        counts = {}
        try:
            with sqlite3.connect(temp) as out:
                dst.backup(out)
                # Never carry destination browser sessions into the deployment artifact.
                out.execute('DELETE FROM session')
                for table in TABLES:
                    rows = src.execute(f'SELECT * FROM "{table}" WHERE user_id=?', (source_user,)).fetchall()
                    counts[table] = len(rows)
                    for row in rows:
                        data = dict(row)
                        data['user_id'] = target_user
                        if table == 'device':
                            data['revoked_at_ms'] = int(time.time() * 1000)
                        columns = ','.join('"' + key.replace('"', '""') + '"' for key in data)
                        placeholders = ','.join('?' for _ in data)
                        out.execute(f'INSERT INTO "{table}" ({columns}) VALUES ({placeholders})', tuple(data.values()))
                if out.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                    raise ValueError('Integrity check failed')
                if out.execute('PRAGMA foreign_key_check').fetchone():
                    raise ValueError('Foreign key check failed')
            os.link(temp, output)  # Atomic publish; refuses existing output.
            return counts
        finally:
            if temp:
                os.unlink(temp)

if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('source_snapshot')
    p.add_argument('destination_snapshot')
    p.add_argument('new_output')
    p.add_argument('--source-user', required=True)
    p.add_argument('--target-user', required=True)
    args = p.parse_args()
    result = prepare(args.source_snapshot, args.destination_snapshot, args.new_output, args.source_user, args.target_user)
    print(json.dumps({'prepared': True, 'rows': result, 'recordings': 'NOT INCLUDED', 'deployed': False}))
