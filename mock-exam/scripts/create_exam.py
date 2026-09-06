"""Copy the bundled app into a new or empty output folder."""
import argparse
import shutil
from pathlib import Path

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output',type=Path)
    args=parser.parse_args()
    target=args.output.resolve()
    if target.exists() and (not target.is_dir() or any(target.iterdir())):
        parser.error('输出目录非空；新增试卷请使用 add_paper.py，不要覆盖现有考场。')
    source=Path(__file__).resolve().parents[1]/'assets/exam-app'
    shutil.copytree(source,target,dirs_exist_ok=True,ignore=shutil.ignore_patterns('__pycache__','*.pyc','attempts','*.log'))
    print(f'Created: {target}')
    print(f'Run: python "{target / "launch.py"}"')

if __name__=='__main__':main()
