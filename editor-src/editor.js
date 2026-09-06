import {basicSetup} from 'codemirror';
import {EditorState, Compartment} from '@codemirror/state';
import {EditorView, keymap, placeholder} from '@codemirror/view';
import {indentWithTab} from '@codemirror/commands';
import {indentUnit} from '@codemirror/language';
import {python} from '@codemirror/lang-python';
import {cpp} from '@codemirror/lang-cpp';
import {oneDark} from '@codemirror/theme-one-dark';

window.ExamEditor = {
  create(parent, {code='', language='python', wrap=true, onChange, onRun}) {
    const wrapping = new Compartment(), editable = new Compartment();
    const view = new EditorView({parent, state: EditorState.create({doc:code, extensions:[
      basicSetup, language==='cpp'?cpp():python(), oneDark, indentUnit.of('    '),
      keymap.of([{key:'Mod-Enter', run:()=>{onRun?.();return true;}}, indentWithTab]),
      wrapping.of(wrap?EditorView.lineWrapping:[]), editable.of(EditorView.editable.of(true)),
      EditorView.contentAttributes.of({'aria-label':'编写解题代码', spellcheck:'false'}),
      placeholder('编写完整程序：从标准输入读取，将结果写入标准输出。'),
      EditorView.updateListener.of(update=>{if(update.docChanged)onChange?.(update.state.doc.toString());}),
      EditorView.theme({
        '&':{height:'440px',fontSize:'14px'},
        '.cm-scroller':{overflow:'auto',fontFamily:'Consolas, Menlo, monospace',lineHeight:'1.7'},
        '.cm-content':{padding:'16px 0',minHeight:'100%'},
        '.cm-gutters':{borderRight:'1px solid #344256'},
        '&.cm-focused':{outline:'2px solid #4b83d5',outlineOffset:'-2px'}
      })
    ]})});
    return {
      getValue:()=>view.state.doc.toString(),
      setValue:value=>view.dispatch({changes:{from:0,to:view.state.doc.length,insert:value}}),
      setWrap:value=>view.dispatch({effects:wrapping.reconfigure(value?EditorView.lineWrapping:[])}),
      setReadOnly:value=>view.dispatch({effects:editable.reconfigure(EditorView.editable.of(!value))}),
      focus:()=>view.focus(), destroy:()=>view.destroy()
    };
  }
};
