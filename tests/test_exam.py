"""Portable stdlib checks; all attempts and generated apps live in temporary folders."""
import copy
import http.client
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import unittest

ROOT=Path(__file__).resolve().parents[1]
APP=ROOT/'mock-exam/assets/exam-app'
sys.path.insert(0,str(APP))
import questions
import server
from judge import CPP,judge_code,matches

class ExamTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp=tempfile.TemporaryDirectory(prefix='mock-exam-test-')
        cls.folder=Path(cls.temp.name)
        server.DATA=cls.folder/'attempts'
        cls.paper=questions.load_paper('demo')
        questions.PAPERS=cls.folder/'papers'
        questions.PAPERS.mkdir()
        cls.write_paper(cls.paper)
        cls.http=server.ThreadingHTTPServer(('127.0.0.1',0),server.Handler)
        server.PORT=cls.http.server_address[1]
        threading.Thread(target=cls.http.serve_forever,daemon=True).start()

    @classmethod
    def write_paper(cls,paper):
        (questions.PAPERS/(paper['id']+'.json')).write_text(json.dumps(paper),encoding='utf-8')

    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown()
        cls.http.server_close()
        cls.temp.cleanup()

    def api(self,path,body=None,token=True,origin=None):
        con=http.client.HTTPConnection('127.0.0.1',server.PORT,timeout=30)
        headers={'Content-Type':'application/json'}
        if token:headers['X-Exam-Token']=server.TOKEN
        if origin:headers['Origin']=origin
        con.request('POST' if body is not None else 'GET',path,json.dumps(body) if body is not None else None,headers)
        res=con.getresponse()
        raw=res.read()
        con.close()
        return res.status,json.loads(raw)

    def wait_report(self,s):
        for _ in range(200):
            _,out=self.api('/api/session/'+s['id'])
            if out['status'] in ('finished','grade_error'):break
            time.sleep(.05)
        self.assertEqual(out['status'],'finished',out)
        return out

    def test_01_private_bank_and_origin(self):
        self.assertEqual(self.api('/api/config',token=False)[0],403)
        self.assertEqual(self.api('/api/config',origin='https://example.com')[0],403)
        _,s=self.api('/api/start',{'paperId':'demo','mode':'full'})
        public=json.dumps(s)
        for private in ('"_paper"','"answer"','"explanation"','"tests"','"reference"'):
            self.assertNotIn(private,public)
        self.assertEqual(self.api('/papers/demo.json')[0],404)
        self.assertEqual(self.api('/api/start',{'paperId':'../demo'})[0],400)

    def test_02_score_save_and_snapshot(self):
        _,s=self.api('/api/start',{'paperId':'demo','mode':'full'})
        draft=s['draft']
        draft['answers']={q['id']:q['answer'][:] for q in self.paper['questions']}
        draft['answers']['4']=['A'] # Partial multiple-choice receives no points.
        p=self.paper['problems'][0]
        draft['codes']['p1']={'language':'python','code':p['reference']}
        self.assertEqual(self.api('/api/save',{'id':s['id'],'draft':draft})[0],200)
        del server.SESSIONS[s['id']]
        self.assertEqual(self.api('/api/session/'+s['id'])[1]['draft'],draft)
        changed=copy.deepcopy(self.paper)
        changed['questions'][0]['answer']=['A']
        self.write_paper(changed)
        try:
            self.api('/api/submit',{'id':s['id'],'draft':draft})
            out=self.wait_report(s)
            self.assertEqual(out['report']['score'],16)
            self.assertEqual(out['report']['total'],20)
            self.assertNotIn('tests',out['report']['problems'][0])
            self.assertIn('reference',out['report']['problems'][0])
            self.assertEqual(self.api('/api/save',{'id':s['id'],'draft':draft})[0],409)
        finally:self.write_paper(self.paper)

    def test_03_choices_and_programming_only(self):
        for kind in ('choice-only','code-only'):
            p=copy.deepcopy(self.paper)
            p['id']=kind
            p['choiceMinutes']=17
            p['questions']=[] if kind=='code-only' else p['questions']
            p['problems']=[] if kind=='choice-only' else p['problems']
            self.write_paper(p)
            mode='choices' if kind=='choice-only' else 'full'
            status,s=self.api('/api/start',{'paperId':kind,'mode':mode})
            self.assertEqual(status,200,s)
            self.assertTrue(s['bank']['questions'] or s['bank']['problems'])
            if kind=='choice-only':self.assertEqual(s['minutes'],17)
            self.api('/api/submit',{'id':s['id'],'draft':s['draft']})
            self.assertEqual(self.wait_report(s)['report']['score'],0)
        self.assertEqual(self.api('/api/start',{'paperId':'code-only','mode':'choices'})[0],400)

    def test_04_sample_custom_errors(self):
        p=self.paper['problems'][0]
        self.assertEqual(judge_code(p,p['reference'],sample_only=True)['passed'],1)
        self.assertLess(judge_code(p,'print("3 6 9 12 9")')['passed'],len(p['tests']))
        self.assertEqual(judge_code(p,'raise ValueError("test")',sample_only=True)['cases'][0]['status'],'RE')
        self.assertEqual(judge_code(p,'while True: pass',sample_only=True)['cases'][0]['status'],'TLE')
        self.assertEqual(judge_code(p,'print("x"*1100000)',sample_only=True)['cases'][0]['status'],'OLE')
        self.assertEqual(judge_code(p,'print(input())',custom_input='hello')['result']['stdout'].strip(),'hello')
        if CPP:
            code='#include <iostream>\nint main(){std::cout << "3 6 9 12 9";}'
            self.assertEqual(judge_code(p,code,'cpp',sample_only=True)['passed'],1)

    def test_05_float_and_invalid_data(self):
        p={'checker':'float','absTol':1e-5,'relTol':1e-5}
        self.assertTrue(matches(p,'0.500001 -0.00','0.5 0.00'))
        for invalid in ('nan 0','inf 0','0.5','wrong 0'):
            self.assertFalse(matches(p,invalid,'0.5 0'))
        bad=copy.deepcopy(self.paper)
        bad['questions'][0]['options'][1]=bad['questions'][0]['options'][0]
        with self.assertRaises(ValueError):questions.validate_paper(bad)

    def test_06_scaffold_and_add(self):
        target=self.folder/'generated'
        create=[sys.executable,str(ROOT/'mock-exam/scripts/create_exam.py'),str(target)]
        subprocess.run(create,check=True,capture_output=True)
        self.assertTrue((target/'editor.bundle.js').is_file())
        self.assertNotEqual(subprocess.run(create,capture_output=True).returncode,0)
        source=self.folder/'new.json'
        p=copy.deepcopy(self.paper);p['id']='extra'
        source.write_text(json.dumps(p),encoding='utf-8')
        add=[sys.executable,str(ROOT/'mock-exam/scripts/add_paper.py'),str(target),str(source)]
        subprocess.run(add,check=True,capture_output=True)
        self.assertNotEqual(subprocess.run(add,capture_output=True).returncode,0)
        subprocess.run(add+['--replace'],check=True,capture_output=True)
        self.assertEqual(json.loads((target/'papers/extra.json').read_text(encoding='utf-8'))['id'],'extra')

if __name__=='__main__':unittest.main()
