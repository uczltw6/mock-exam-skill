"""Loopback-only exam app. Standard library; no online service required."""
import argparse
import copy
import json
import re
import secrets
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from judge import CPP, judge_code
from questions import DEFAULT_PAPER, catalog, load_paper, selected_content, public_bank

ROOT = Path(__file__).resolve().parent
DATA = ROOT / 'attempts'
TOKEN = secrets.token_hex(24)
LOCK = threading.RLock()
RUN_LOCK = threading.Lock()
WORKERS = set()
SESSIONS = {}
PORT = 18764

def persist(s):
    DATA.mkdir(exist_ok=True)
    target = DATA / (s['id']+'.json')
    tmp = target.with_suffix('.tmp')
    tmp.write_text(json.dumps(s, ensure_ascii=False), encoding='utf-8')
    tmp.replace(target)

def load(sid):
    if not re.fullmatch('[a-f0-9]{32}', sid):
        raise ValueError('无效考试编号')
    if sid not in SESSIONS:
        p = DATA/(sid+'.json')
        if not p.exists():
            raise ValueError('找不到考试记录')
        SESSIONS[sid] = json.loads(p.read_text(encoding='utf-8'))
    s = SESSIONS[sid]
    if '_paper' not in s:
        s['_paper'] = load_paper(s.get('paperId', DEFAULT_PAPER))
        s['paperId'] = s['_paper']['id']
        s['paperName'] = s['_paper']['name']
    return s

def clean_draft(payload, s):
    draft = payload.get('draft', {})
    if not isinstance(draft, dict):
        raise ValueError('答卷格式无效')
    ans = {}
    questions, problems = selected_content(s['_paper'], s['mode'])
    for q in questions:
        val = draft.get('answers', {}).get(q['id'], [])
        if not isinstance(val, list) or any(v not in 'ABCD' or len(v)!=1 for v in val):
            raise ValueError('选项无效')
        ans[q['id']] = sorted(set(val))[:4 if q['multi'] else 1]
    codes = {}
    for pid in (p['id'] for p in problems):
        entry = draft.get('codes', {}).get(pid, {})
        lang = entry.get('language', 'python')
        if lang not in ('python', 'cpp'):
            raise ValueError('语言无效')
        code = entry.get('code', '')
        if not isinstance(code, str) or len(code.encode('utf-8'))>100000:
            raise ValueError('代码过长或格式无效')
        codes[pid] = dict(language=lang, code=code)
    flags = draft.get('flags', [])
    if not isinstance(flags, list):
        raise ValueError('标记格式无效')
    allowed = {q['id'] for q in questions} | {p['id'] for p in problems}
    s['draft'] = dict(answers=ans, codes=codes, flags=[v for v in flags if v in allowed])
    s['savedAt'] = time.time()

def grade(sid):
    try:
        with LOCK:
            s = copy.deepcopy(load(sid))
        objective = []
        questions, problems = selected_content(s['_paper'], s['mode'])
        for q in questions:
            given = s['draft']['answers'].get(q['id'], [])
            score = q['points'] if sorted(given)==sorted(q['answer']) else 0
            objective.append(dict(**q, given=given, score=score))
        programming = []
        with RUN_LOCK:
            for p in problems:
                entry = s['draft']['codes'].get(p['id'], dict(code='', language='python'))
                result = judge_code(p, entry['code'], entry['language'])
                score = round(p['points']*result['passed']/result['total'], 2)
                programming.append(dict(**{k:v for k,v in p.items() if k not in ('tests','reference')}, **entry, result=result, score=score, reference=p['reference']))
        report = dict(questions=objective, problems=programming, sources=s['_paper']['sources'],
                      objectiveScore=sum(q['score'] for q in objective),
                      programmingScore=round(sum(p['score'] for p in programming),2))
        report['score'] = round(report['objectiveScore']+report['programmingScore'], 2)
        report['total'] = sum(q['points'] for q in questions) + sum(p['points'] for p in problems)
        with LOCK:
            live = load(sid)
            live.update(status='finished', report=report)
            live.pop('error', None)
            persist(live)
    except Exception as e:
        with LOCK:
            live = load(sid)
            live.update(status='grade_error', error='判分未完成，答卷已保留：'+str(e))
            persist(live)
    finally:
        with LOCK:
            WORKERS.discard(sid)

def begin_grade(s, reason='manual'):
    if s['status'] == 'finished':
        return
    if s['id'] in WORKERS:
        return
    if not s.get('submittedAt'):
        s['submittedAt'] = min(time.time(), s['deadline'])
        s['reason'] = reason
    s['status'] = 'grading'
    persist(s)
    WORKERS.add(s['id'])
    threading.Thread(target=grade, args=(s['id'],), daemon=True).start()

def public_session(s):
    result = copy.deepcopy(s)
    result.pop('_paper', None)
    result['serverTime'] = time.time()
    result['bank'] = public_bank(s['mode'], s['_paper'])
    return result

class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def reply(self, data, code=200, mime='application/json; charset=utf-8'):
        body = json.dumps(data, ensure_ascii=False).encode('utf-8') if isinstance(data, (dict,list)) else data
        self.send_response(code)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('X-Frame-Options', 'DENY')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'")
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass

    def authorized(self):
        expected = f'127.0.0.1:{PORT}'
        if self.headers.get('Host') != expected:
            self.reply(dict(error='无效主机'),403)
            return False
        origin = self.headers.get('Origin')
        if origin and origin != f'http://{expected}':
            self.reply(dict(error='仅支持本机同源访问'),403)
            return False
        if self.path.startswith('/api/') and self.headers.get('X-Exam-Token') != TOKEN:
            self.reply(dict(error='页面已过期，请刷新页面后重试'),403)
            return False
        return True

    def do_GET(self):
        if not self.authorized():
            return
        path = urlparse(self.path).path
        if path == '/health':
            return self.reply(dict(app='mock-exam', version=1))
        if path in ('/', '/index.html'):
            html = (ROOT/'index.html').read_text(encoding='utf-8').replace('__EXAM_TOKEN__', TOKEN)
            return self.reply(html.encode('utf-8'), mime='text/html; charset=utf-8')
        if path in ('/app.js', '/style.css', '/editor.bundle.js'):
            mime = 'text/javascript; charset=utf-8' if path.endswith('.js') else 'text/css; charset=utf-8'
            return self.reply((ROOT/path[1:]).read_bytes(), mime=mime)
        if path == '/api/config':
            return self.reply(dict(languages=['python']+(['cpp'] if CPP else []), defaultMode='choices', papers=catalog()))
        if path.startswith('/api/session/'):
            try:
                with LOCK:
                    s = load(path.rsplit('/',1)[-1])
                    if s['status']=='active' and time.time()>=s['deadline']:
                        begin_grade(s, 'timeout')
                    elif s['status']=='grading':
                        begin_grade(s, s.get('reason','manual'))
                    return self.reply(public_session(s))
            except ValueError as e:
                return self.reply(dict(error=str(e)),404)
        self.reply(dict(error='找不到页面'),404)

    def do_POST(self):
        if not self.authorized():
            return
        try:
            length = int(self.headers.get('Content-Length','0'))
            if length <= 0 or length>500000:
                raise ValueError('请求内容过大或为空')
            payload = json.loads(self.rfile.read(length))
            if not isinstance(payload, dict):
                raise ValueError('请求格式无效')
            path = urlparse(self.path).path
            if path == '/api/start':
                mode = payload.get('mode', 'choices')
                paper = load_paper(payload.get('paperId', DEFAULT_PAPER))
                minutes = payload.get('minutes', paper.get('choiceMinutes', 30) if mode == 'choices' else paper.get('fullMinutes',120))
                if type(minutes) is not int or not 1<=minutes<=240 or mode not in tuple(m['id'] for item in catalog() if item['id']==paper['id'] for m in item['modes']):
                    raise ValueError('考试设置无效')
                if not any(selected_content(paper, mode)):
                    raise ValueError('所选范围没有题目')
                now = time.time()
                s = dict(id=secrets.token_hex(16), name=str(payload.get('name','考生'))[:40] or '考生',
                         mode=mode, minutes=minutes, startedAt=now, deadline=now+60*minutes,
                         status='active', savedAt=now, visibilityChanges=0,
                         paperId=paper['id'], paperName=paper['name'], _paper=paper)
                clean_draft({}, s)
                with LOCK:
                    SESSIONS[s['id']] = s
                    persist(s)
                return self.reply(public_session(s))
            sid = payload.get('id','')
            with LOCK:
                s = load(sid)
                if s['status']=='active' and time.time()>=s['deadline']:
                    begin_grade(s, 'timeout')
                if path == '/api/submit':
                    if s['status']=='active':
                        clean_draft(payload,s)
                        begin_grade(s)
                    elif s['status']=='grade_error':
                        begin_grade(s)
                    return self.reply(public_session(s))
                if s['status'] != 'active':
                    return self.reply(dict(error='考试已结束，不能继续修改答卷', session=public_session(s)),409)
                if path == '/api/save':
                    clean_draft(payload,s)
                    persist(s)
                    return self.reply(dict(savedAt=s['savedAt'], serverTime=time.time()))
                if path == '/api/visibility':
                    s['visibilityChanges'] += 1
                    persist(s)
                    return self.reply(dict(count=s['visibilityChanges']))
                if path != '/api/run':
                    return self.reply(dict(error='不存在的操作'),404)
                pid = payload.get('problem')
                if pid not in {p['id'] for p in selected_content(s['_paper'], s['mode'])[1]}:
                    raise ValueError('无效题目')
                problem = next(p for p in s['_paper']['problems'] if p['id'] == pid)
                clean_draft(payload,s)
                persist(s)
                entry = copy.deepcopy(s['draft']['codes'][pid])
                custom = payload.get('input') if payload.get('custom') else None
                if custom is not None and not isinstance(custom,str):
                    raise ValueError('自定义输入格式无效')
            if not RUN_LOCK.acquire(blocking=False):
                return self.reply(dict(error='上一段程序仍在运行，请稍后重试'),409)
            try:
                result = judge_code(problem,entry['code'],entry['language'],custom_input=custom,sample_only=True)
                return self.reply(result)
            finally:
                RUN_LOCK.release()
        except (ValueError, TypeError, KeyError, AttributeError) as e:
            self.reply(dict(error=str(e)),400)
        except Exception as e:
            self.reply(dict(error='操作失败，已保存的答卷不会丢失：'+str(e)),500)

def main():
    global PORT
    parser = argparse.ArgumentParser()
    parser.add_argument('--port',type=int,default=18764)
    args = parser.parse_args()
    PORT = args.port
    server = ThreadingHTTPServer(('127.0.0.1',PORT),Handler)
    print(f'Exam ready: http://127.0.0.1:{PORT}',flush=True)
    server.serve_forever()

if __name__ == '__main__':
    main()
