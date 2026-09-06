"""Private JSON papers, validation, and explicit public-field projections."""
import json
import math
import re
from pathlib import Path

PAPERS = Path(__file__).resolve().parent/'papers'
DEFAULT_PAPER = 'demo'

def validate_paper(p):
    def require(condition, message):
        if not condition:
            raise ValueError(message)
    require(isinstance(p,dict), '试卷必须为 JSON 对象')
    require(isinstance(p.get('id'),str) and re.fullmatch(r'[a-z0-9-]+',p['id']), '无效试卷编号')
    for field in ('name','title','description','sourceNote'):
        require(isinstance(p.get(field),str) and bool(p[field].strip()), '缺少字段：'+field)
    qs, ps = p.get('questions'),p.get('problems')
    require(isinstance(qs,list) and isinstance(ps,list) and bool(qs or ps), '试卷必须包含题目')
    ids=[]
    for q in qs+ps:
        require(isinstance(q,dict), '题目必须为对象')
        require(isinstance(q.get('id'),str) and re.fullmatch(r'[a-zA-Z0-9-]+',q['id']), '无效题号')
        ids.append(q['id'])
        require(type(q.get('points')) in (int,float) and math.isfinite(q['points']) and q['points']>0, '分值必须为正数')
        require(isinstance(q.get('explanation'),str) and bool(q['explanation'].strip()), '每题需要解析')
    require(len(ids)==len(set(ids)), '题号重复')
    for q in qs:
        for field in ('text','topic','source'):
            require(isinstance(q.get(field),str) and bool(q[field].strip()), '选择题缺少 '+field)
        options=q.get('options')
        require(isinstance(options,list) and len(options)==4 and all(isinstance(x,str) and x.strip() for x in options), '需要四个非空选项')
        require(len(set(options))==4, '选项重复')
        answer=q.get('answer')
        require(isinstance(answer,list) and bool(answer) and all(x in ('A','B','C','D') for x in answer), '答案无效')
        require(len(answer)==len(set(answer)), '答案重复')
        require(type(q.get('multi')) is bool and (q['multi'] or len(answer)==1), '单选只能有一个答案')
    for q in ps:
        for field in ('title','source','description','input','output','sampleIn','sampleOut','sampleNote','convention','reference'):
            require(isinstance(q.get(field),str), '编程题缺少 '+field)
        require(bool(q['reference'].strip()), '编程题需要 Python 参考实现')
        require(isinstance(q.get('rules'),list) and all(isinstance(x,str) for x in q['rules']), 'rules 必须为文本列表')
        tests=q.get('tests')
        require(isinstance(tests,list) and bool(tests), '编程题缺少测试')
        for t in tests:
            require(isinstance(t,dict) and all(isinstance(t.get(k),str) for k in ('label','input','expected')), '测试格式错误')
        require(tests[0]['input'].split()==q['sampleIn'].split() and tests[0]['expected'].split()==q['sampleOut'].split(), '首个测试必须是公开样例')
        require(q.get('checker','tokens') in ('tokens','float'), 'checker 仅支持 tokens 或 float')
        for field in ('absTol','relTol'):
            value=q.get(field,1e-6)
            require(type(value) in (int,float) and math.isfinite(value) and value>=0, '无效浮点容差')
    for field, default in (('choiceMinutes',30),('fullMinutes',120)):
        require(type(p.get(field,default)) is int and 1<=p.get(field,default)<=240, '时长需在 1–240 分钟')
    require(isinstance(p.get('sources'),list), 'sources 必须为列表')
    for source in p['sources']:
        require(isinstance(source,dict) and isinstance(source.get('title'),str), '来源缺少标题')
        require('url' not in source or (isinstance(source['url'],str) and source['url'].startswith(('https://','http://'))), '来源链接仅支持 http(s)')
    return p

def load_paper(paper_id=DEFAULT_PAPER):
    if not isinstance(paper_id,str) or not re.fullmatch(r'[a-z0-9-]+',paper_id):
        raise ValueError('无效试卷编号')
    path=PAPERS/(paper_id+'.json')
    if not path.is_file():
        raise ValueError('找不到这套试卷')
    paper=validate_paper(json.loads(path.read_text(encoding='utf-8')))
    if paper['id']!=paper_id:
        raise ValueError('文件名与试卷编号不一致')
    return paper

def selected_content(paper,mode):
    qs=paper['questions']
    if mode=='source':
        return [q for q in qs if q['source']=='原题收录'],[p for p in paper['problems'] if p.get('sourceType')=='原题收录']
    return qs,([] if mode=='choices' else paper['problems'])

def catalog():
    result=[]
    for path in sorted(PAPERS.glob('*.json')):
        p=load_paper(path.stem)
        modes=[]
        for mode,label,minutes in [('choices','只考选择题',p.get('choiceMinutes',30)),('full','整套考试（含编程）',p.get('fullMinutes',120)),('source','仅原题收录',p.get('fullMinutes',120))]:
            qs,ps=selected_content(p,mode)
            if not(qs or ps) or (mode=='full' and not ps):continue
            if mode=='source' and qs==p['questions'] and ps==p['problems']:continue
            single=[q for q in qs if not q['multi']]
            multi=[q for q in qs if q['multi']]
            modes.append(dict(id=mode,label=label,minutes=minutes,count=len(qs)+len(ps),
                total=sum(q['points'] for q in qs+ps),singleCount=len(single),multiCount=len(multi),codeCount=len(ps),
                singlePoints=sum(q['points'] for q in single),multiPoints=sum(q['points'] for q in multi),codePoints=sum(q['points'] for q in ps)))
        result.append({**{k:p[k] for k in ('id','name','title','description','sourceNote')},'retainedCodeCount':len(p['problems']),'modes':modes})
    return result

def public_bank(mode,paper):
    qs,ps=selected_content(paper,mode)
    qfields=('id','topic','text','options','multi','points','source','originalNumber')
    pfields=('id','title','shortTitle','points','source','sourceType','description','rules','input','output','sampleIn','sampleOut','sampleNote','convention')
    return dict(questions=[{k:q[k] for k in qfields if k in q} for q in qs],
                problems=[{k:p[k] for k in pfields if k in p} for p in ps])
