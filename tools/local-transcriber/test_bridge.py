import http.client,json,tempfile,threading,unittest
from pathlib import Path
from bridge import Bridge
class BridgeTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.server=Bridge(('127.0.0.1',0),Path(self.temp.name),Path('unused'),{'https://cockpit.example'},'test-key')
  threading.Thread(target=self.server.serve_forever,daemon=True).start()
 def tearDown(self):self.server.shutdown();self.server.server_close();self.temp.cleanup()
 def request(self,method,path,headers=None):
  c=http.client.HTTPConnection('127.0.0.1',self.server.server_port)
  c.request(method,path,headers=headers or {});r=c.getresponse();body=r.read();c.close();return r.status,dict(r.getheaders()),body
 def test_auth_and_origin(self):
  for h in [{},{'Origin':'https://evil.example','Authorization':'Bearer test-key'},{'Origin':'https://cockpit.example','Authorization':'Bearer wrong'}]:self.assertEqual(self.request('GET','/health',h)[0],403)
  h={'Origin':'https://cockpit.example','Authorization':'Bearer test-key'}
  self.assertEqual(self.request('GET','/health',h)[0],200)
  self.assertEqual(self.request('GET','/health',{**h,'Host':'evil.example'})[0],403)
 def test_preflight_and_size(self):
  h={'Origin':'https://cockpit.example','Authorization':'Bearer test-key'}
  status,headers,_=self.request('OPTIONS','/jobs',h);self.assertEqual(status,204);self.assertEqual(headers['Access-Control-Allow-Origin'],h['Origin'])
  self.assertEqual(self.request('POST','/jobs',{**h,'Content-Length':str(4*1024**3+1)})[0],413)
  self.assertEqual(self.request('POST','/jobs',h)[0],413)
 def test_only_one_active_job(self):
  self.server.active='busy'
  self.assertEqual(self.request('POST','/jobs',{'Origin':'https://cockpit.example','Authorization':'Bearer test-key','Content-Length':'1'})[0],409)
if __name__=='__main__':unittest.main()
