#!/usr/bin/env python3
"""Loopback-only, origin- and token-protected local transcription bridge."""
import argparse, hmac, json, os, secrets, signal, subprocess, sys, tempfile, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote
from transcribe import DEFAULT_MODEL
MAX_BYTES=4*1024**3
class Bridge(ThreadingHTTPServer):
    daemon_threads=True
    def __init__(self, address, output, model, origins, token):
        self.output=output;self.model=model;self.origins=origins;self.token=token
        self.jobs={};self.guard=threading.Lock();self.active=None
        super().__init__(address, Handler)
class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args): pass
    def allowed(self, auth=True):
        s=self.server
        return self.headers.get('Host')==f'127.0.0.1:{s.server_port}' and self.headers.get('Origin') in s.origins and (not auth or hmac.compare_digest(self.headers.get('Authorization',''), 'Bearer '+s.token))
    def reply(self,code,obj):
        raw=json.dumps(obj,ensure_ascii=False).encode()
        self.send_response(code)
        origin=self.headers.get('Origin')
        if origin in self.server.origins:self.send_header('Access-Control-Allow-Origin',origin)
        self.send_header('Vary','Origin');self.send_header('Cache-Control','no-store')
        self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(raw)))
        self.end_headers()
        try:self.wfile.write(raw)
        except (BrokenPipeError,ConnectionResetError):pass
    def do_OPTIONS(self):
        if not self.allowed(False):return self.reply(403,{'error':'接続元を許可していません。'})
        self.send_response(204);self.send_header('Access-Control-Allow-Origin',self.headers['Origin'])
        self.send_header('Access-Control-Allow-Methods','GET, POST, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers','Authorization, Content-Type, X-File-Name')
        self.send_header('Access-Control-Allow-Private-Network','true');self.send_header('Vary','Origin');self.end_headers()
    def do_GET(self):
        if not self.allowed():return self.reply(403,{'error':'接続キーを確認してください。'})
        if self.path=='/health':return self.reply(200,{'mode':'accurate','protocol':1})
        job=self.server.jobs.get(self.path.removeprefix('/jobs/'))
        if not self.path.startswith('/jobs/') or not job:return self.reply(404,{'error':'処理がありません。'})
        status={'status':job['state']}
        folders=list(job['folder'].glob('transcription-*'))
        if folders:
            statusfile=folders[0]/'status.json'
            if statusfile.exists():status.update(json.loads(statusfile.read_text()))
            if job['state']=='done':
                status['segments']=[json.loads(x) for x in (folders[0]/'segments.jsonl').read_text().splitlines()]
        status['status']=job['state'] if job['state'] in ('done','error','cancelled') else status['status']
        if job['state']=='error':status['error']='精密処理に失敗しました。補助ツールの保存先のprocess.logを確認してください。'
        return self.reply(200,status)
    def do_POST(self):
        if not self.allowed():return self.reply(403,{'error':'接続キーを確認してください。'})
        if self.path!='/jobs':return self.reply(404,{})
        try:size=int(self.headers.get('Content-Length','0'))
        except ValueError:return self.reply(400,{})
        if not 0<size<=MAX_BYTES:return self.reply(413,{'error':'4GiB以下のファイルを選択してください。'})
        s=self.server
        with s.guard:
            if s.active:return self.reply(409,{'error':'別の文字起こしが実行中です。'})
            key=secrets.token_hex(16);s.active=key
        folder=Path(tempfile.mkdtemp(prefix='cockpit-job-',dir=s.output))
        name=Path(unquote(self.headers.get('X-File-Name','recording'))).name
        name=''.join(c for c in name if c.isprintable())[:180] or 'recording'
        while len(name.encode('utf-8')) > 180:name=name[:-1]
        if name in ('.','..'):name='recording'
        (folder/'input').mkdir()
        source=folder/'input'/name
        job={'folder':folder,'state':'uploading','process':None};s.jobs[key]=job
        try:
            self.connection.settimeout(120)
            with source.open('wb') as out:
                remaining=size
                while remaining:
                    chunk=self.rfile.read(min(1024*1024,remaining))
                    if not chunk:raise ValueError('転送が中断されました。')
                    out.write(chunk);remaining-=len(chunk)
            log=(folder/'process.log').open('w')
            job['process']=subprocess.Popen([sys.executable,str(Path(__file__).with_name('transcribe.py')),'--input',str(source),'--output',str(folder),'--model',str(s.model)],stdout=log,stderr=log)
            job['state']='running'
            def finish():
                code=job['process'].wait();log.close();source.unlink(missing_ok=True)
                if job['state']!='cancelled':job['state']='done' if code==0 else 'error'
                with s.guard:s.active=None
            threading.Thread(target=finish,daemon=True).start()
            return self.reply(202,{'id':key})
        except Exception:
            source.unlink(missing_ok=True);job['state']='error'
            with s.guard:s.active=None
            return self.reply(400,{'error':'端末内へのファイル転送に失敗しました。'})
    def do_DELETE(self):
        if not self.allowed():return self.reply(403,{})
        job=self.server.jobs.get(self.path.removeprefix('/jobs/'))
        if not self.path.startswith('/jobs/') or not job:return self.reply(404,{})
        if job['process'] and job['process'].poll() is None:
            job['state']='cancelled';job['process'].send_signal(signal.SIGINT)
        return self.reply(200,{'status':job['state']})
def main():
    os.umask(0o077)
    p=argparse.ArgumentParser();p.add_argument('--output',type=Path,default=Path.home()/'Documents/CockpitTranscripts');p.add_argument('--model',type=Path,default=DEFAULT_MODEL)
    p.add_argument('--allow-origin',action='append',default=[]);p.add_argument('--token-file',type=Path)
    a=p.parse_args();a.output.mkdir(parents=True,exist_ok=True)
    token=secrets.token_urlsafe(32)
    if a.token_file:a.token_file.write_text(token)
    server=Bridge(('127.0.0.1',8765),a.output,a.model,{'https://cockpit.yamashirogyomukaizen.com','https://cockpit-staging.yamashirogyomukaizen.com',*a.allow_origin},token)
    print('Cockpit端末内接続を起動しました。画面の接続キー欄に次を貼り付けてください:\n'+token,flush=True)
    print('保存先: '+str(a.output)+'\n終了するにはControl+C。処理中はこのウィンドウを開いてください。',flush=True)
    try:server.serve_forever()
    except KeyboardInterrupt:pass
    finally:
        for job in server.jobs.values():
            if job['process'] and job['process'].poll() is None:job['process'].send_signal(signal.SIGINT)
        server.server_close()
if __name__=='__main__':main()
