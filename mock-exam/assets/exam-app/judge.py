"""Local execution for the learner's own code; not a hostile-code sandbox."""
import math
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

CPP = shutil.which('g++')

def matches(problem, actual, expected):
    a,b=actual.split(),expected.split()
    if len(a)!=len(b):return False
    if problem.get('checker','tokens')=='tokens':return a==b
    try:
        return all(math.isfinite(float(x)) and math.isfinite(float(y)) and math.isclose(
            float(x),float(y),rel_tol=problem.get('relTol',1e-6),abs_tol=problem.get('absTol',1e-6)) for x,y in zip(a,b))
    except ValueError:
        return False

def run_process(command, input_text, cwd, limit=4):
    """Bound runtime and captured output. Intended only for the user's own code."""
    started = time.monotonic()
    with tempfile.TemporaryFile() as inp, tempfile.TemporaryFile() as out, tempfile.TemporaryFile() as err:
        inp.write(input_text.encode('utf-8'))
        inp.seek(0)
        env = {k: v for k, v in os.environ.items() if k.upper() in ('SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'PATH', 'PATHEXT')}
        env['PYTHONIOENCODING'] = 'utf-8'
        flags = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
        p = subprocess.Popen(command, stdin=inp, stdout=out, stderr=err, cwd=cwd,
                             env=env, creationflags=flags)
        status = 'OK'
        while p.poll() is None:
            if time.monotonic()-started > limit:
                status = 'TLE'
                p.kill()
                break
            if os.fstat(out.fileno()).st_size+os.fstat(err.fileno()).st_size > 1048576:
                status = 'OLE'
                p.kill()
                break
            time.sleep(.015)
        p.wait()
        if status == 'OK' and os.fstat(out.fileno()).st_size+os.fstat(err.fileno()).st_size > 1048576:
            status = 'OLE'
        if status == 'OK' and p.returncode:
            status = 'RE'
        out.seek(0)
        err.seek(0)
        return dict(status=status, stdout=out.read(1048576).decode('utf-8', 'replace'),
                    stderr=err.read(8192).decode('utf-8', 'replace'), ms=round((time.monotonic()-started)*1000))

def judge_code(problem, code, language='python', custom_input=None, sample_only=False):
    if language not in ('python', 'cpp'):
        raise ValueError('不支持的语言')
    if len(code.encode('utf-8')) > 100000:
        raise ValueError('代码超过 100 KB')
    if not code.strip():
        return dict(passed=0, total=len(problem['tests']), cases=[], message='未作答')
    with tempfile.TemporaryDirectory(prefix='ai-exam-') as folder:
        root = Path(folder)
        if language == 'python':
            path = root/'main.py'
            path.write_text(code, encoding='utf-8')
            command = [sys.executable, '-I', '-X', 'utf8', str(path)]
        else:
            if not CPP:
                raise ValueError('本机没有 C++ 编译器，请选择 Python')
            path = root/'main.cpp'
            path.write_text(code, encoding='utf-8')
            exe = root/('main.exe' if os.name == 'nt' else 'main')
            build = run_process([CPP, '-std=c++17', '-O2', str(path), '-o', str(exe)], '', folder, 25)
            if build['status'] != 'OK':
                return dict(passed=0, total=len(problem['tests']), cases=[], message='编译失败', compile=build)
            command = [str(exe)]
        if custom_input is not None:
            if len(custom_input) > 100000:
                raise ValueError('自定义输入超过 100 KB')
            return dict(custom=True, result=run_process(command, custom_input, folder))
        cases = problem['tests'][:1] if sample_only else problem['tests']
        outcomes = []
        for case in cases:
            result = run_process(command, case['input'], folder)
            if result['status'] == 'OK':
                result['status'] = 'AC' if matches(problem,result['stdout'],case['expected']) else 'WA'
            result['label'] = case['label']
            if sample_only:
                result['expected'] = case['expected']
            else:
                result.pop('stdout', None)
                result.pop('stderr', None)
            outcomes.append(result)
            if result['status'] in ('TLE', 'OLE'):
                # Stop runaway programs after two resource-limit failures.
                if sum(x['status'] in ('TLE', 'OLE') for x in outcomes) >= 2:
                    outcomes.extend(dict(label=c['label'], status='SKIP', ms=0) for c in cases[len(outcomes):])
                    break
        return dict(passed=sum(c['status']=='AC' for c in outcomes), total=len(cases), cases=outcomes)
