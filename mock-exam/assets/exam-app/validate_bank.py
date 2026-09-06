"""Validate local paper data; optionally run authored reference programs."""
import argparse
from questions import PAPERS,load_paper,catalog
from judge import judge_code

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run-references',action='store_true')
    args=parser.parse_args()
    papers=catalog()
    if not papers:raise ValueError('题库为空')
    for path in sorted(PAPERS.glob('*.json')):
        p=load_paper(path.stem)
        print(p['id'],len(p['questions']),'choice',len(p['problems']),'coding')
        if args.run_references:
            for problem in p['problems']:
                result=judge_code(problem,problem['reference'])
                if result['passed']!=result['total']:raise AssertionError((p['id'],problem['id'],result))
                print(' ',problem['id'],'reference PASS',result['total'])

if __name__=='__main__':main()
