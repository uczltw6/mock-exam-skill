"""Validate and atomically add a paper; never modify attempts."""
import argparse
import importlib.util
import json
import os
import tempfile
from pathlib import Path

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('exam',type=Path)
    parser.add_argument('paper',type=Path)
    parser.add_argument('--replace',action='store_true',help='Explicitly update the same paper; old attempts keep snapshots.')
    args=parser.parse_args()
    root=args.exam.resolve()
    if not (root/'questions.py').is_file() or not (root/'papers').is_dir():
        parser.error('找不到由本 skill 创建的考场目录')
    spec=importlib.util.spec_from_file_location('paper_validation',Path(__file__).resolve().parents[1]/'assets/exam-app/questions.py')
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    paper=module.validate_paper(json.loads(args.paper.read_text(encoding='utf-8')))
    target=root/'papers'/(paper['id']+'.json')
    if target.exists() and not args.replace:
        parser.error('同编号试卷已存在；修改同一套卷时才使用 --replace')
    text=json.dumps(paper,ensure_ascii=False,indent=2)+'\n'
    if not args.replace:
        with target.open('x',encoding='utf-8') as stream:stream.write(text)
    else:
        with tempfile.NamedTemporaryFile(mode='w',encoding='utf-8',dir=target.parent,suffix='.tmp',delete=False) as stream:
            stream.write(text)
            temporary=stream.name
        os.replace(temporary,target)
    print(f'Saved {paper["name"]}: {len(paper["questions"])} choice + {len(paper["problems"])} coding')
    print('刷新选卷页即可看到更新，已开始的考试继续使用原快照。')

if __name__=='__main__':main()
