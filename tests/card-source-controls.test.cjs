'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const original = fs.readFileSync(path.join(__dirname, '..', 'rezka.js'), 'utf8');
const injection = '    window.__cardTest = { addCardButton, rezkaAddButtonSettings };' +
  '\n})();';
assert.ok(original.includes('    bootstrap();\n})();'), 'instrumentation anchor present');
const script = original.replace('    bootstrap();\n})();', injection);

class Node {
  constructor(classes, text='', markup='') {
    this.classes=new Set(classes.split(/\s+/).filter(Boolean));
    this.label=text;
    this.markup=markup;
    this.items=[];
    this.parent=null;
    this.handlers={};
  }
}
function wrap(nodes, context) {
  if (!(nodes instanceof Array)) nodes=nodes?[nodes]:[];
  const api = {
    length:nodes.length,
    0:nodes[0],
    first:()=>wrap(nodes.slice(0,1),context),
    hasClass:cls=>!!nodes[0]?.classes.has(cls),
    text:()=>nodes[0]?.label||'',
    on(event,fn){for(const n of nodes)n.handlers[event]=fn;return api;},
    toggleClass(cls,value){for(const n of nodes)value?n.classes.add(cls):n.classes.delete(cls);return api;},
    addClass(cls){return api.toggleClass(cls,true);},
    removeClass(cls){return api.toggleClass(cls,false);},
    append(node){place(nodes[0],node[0],null);return api;},
    prepend(node){place(nodes[0],node[0],0);return api;},
    after(node){
      const target=nodes[0];if(target?.parent)place(target.parent,node[0],target.parent.items.indexOf(target)+1);
      return api;
    },
    before(node){
      const target=nodes[0];if(target?.parent)place(target.parent,node[0],target.parent.items.indexOf(target));
      return api;
    },
    children(selector){return wrap((nodes[0]?.items||[]).filter(n=>match(n,selector)),context);},
    find(selector) {
      let found=[];
      function walk(parent){
        for(const n of parent.items){if(match(n,selector))found.push(n);walk(n);}
      }
      for(const n of nodes)walk(n);
      return wrap(found,context);
    },
    closest(selector){
      let n=nodes[0];
      while(n){if(match(n,selector))return wrap(n,context);n=n.parent;}
      return wrap([],context);
    },
    each(fn){nodes.forEach((n,i)=>fn.call(n,i,n));return api;}
  };
  return api;
}
function match(n,selector) {
  if (!selector) return true;
  return selector.split(',').some(sel=>{
    const target=sel.trim().split(/\s+|>/).filter(Boolean).at(-1);
    if(!target)return false;
    return [...target.matchAll(/\.([a-zA-Z0-9_-]+)/g)].every(m=>n.classes.has(m[1]));
  });
}
function place(parent,node,index) {
  if(!parent || !node)return;
  if(node.parent){
    const old=node.parent.items.indexOf(node);
    if(old!==-1)node.parent.items.splice(old,1);
  }
  if(index===null)parent.items.push(node);
  else parent.items.splice(Math.min(index,parent.items.length),0,node);
  node.parent=parent;
}
function setup({card=true,source=true,continueButton=true, modern=true}={}) {
  const storage={rezka_show_card_button:card,rezka_show_source_button:source};
  const fields=[],listeners=[],pushes=[],timers=[],styles=[];
  const root=new Node('root');
  const row=new Node(modern?'full-start-new__buttons':'full-start__buttons');
  const play=new Node('full-start__button button--play','Смотреть');
  place(root,row,null);place(row,play,null);
  const sources=new Node('buttons--container hide');
  place(root,sources,null);
  const torrent=new Node('full-start__button view--torrent','Торренты');
  const resume=new Node('full-start__button view--continue','Продолжить · С1Е3 · с начала');
  const online=new Node('full-start__button view--online','Онлайн');
  const trailer=new Node('full-start__button view--trailer','Трейлеры');
  place(sources,torrent,null);
  if(continueButton)place(sources,resume,null);
  place(sources,online,null);place(sources,trailer,null);
  function jq(a){
    if(typeof a==='string'){
      if(a[0]==='<'){
        const classes=/class="([^"]+)"/.exec(a)?.[1]||'';
        const label=/<span>([^<]*)<\/span>/.exec(a)?.[1]||'';
        return wrap(new Node(classes,label,a),jq);
      }
      let select=a.trim();
      if(select.startsWith('.buttons--container'))return wrap((sources.items||[]).filter(n=>match(n,select)),jq);
      if(select.includes('.view--rezka-source'))return wrap(sources.items.filter(n=>match(n,select)),jq);
      if(select.includes('.view--rezka'))return wrap(row.items.filter(n=>match(n,select)),jq);
      return wrap([],jq);
    }
    return wrap(a,jq);
  }
  const Lampa={
    Storage:{get:(k,d)=>storage[k]===undefined?d:storage[k],set:(k,v)=>{storage[k]=v;}},
    Listener:{follow:(key,fn)=>{if(key==='full')listeners.push(fn);}},
    SettingsApi:{addParam:p=>fields.push(p)},
    Activity:{push:o=>pushes.push(o)}
  };
  const document={
    getElementById:()=>null,
    createElement:()=>({id:'',textContent:''}),
    head:{appendChild:s=>styles.push(s)}
  };
  const w={};
  vm.runInNewContext(script,{
    window:w,Lampa,document,$:jq,setTimeout:fn=>timers.push(fn),console,URL
  },{timeout:4000});
  w.__cardTest.addCardButton();
  w.__cardTest.rezkaAddButtonSettings();
  const render=()=>jq(root);
  const emit=()=>listeners.forEach(fn=>fn({
    type:'complite',object:{activity:{render},card:{title:'Карточка'}},
    data:{movie:{title:'Карточка'}}
  }));
  const visibleItems=()=>row.items.map(n=>n.label);
  const sourceItems=()=>sources.items.map(n=>n.label);
  return {storage,fields,styles,listeners,row,sources,play,resume,online,trailer,timers,pushes,
    emit,visibleItems,sourceItems,runTimers:()=>{while(timers.length)timers.shift()();},
    addLateContinue:()=>place(sources,resume,sources.items.indexOf(torrent)+1),
    card:()=>row.items.find(n=>n.classes.has('view--rezka')),
    source:()=>sources.items.find(n=>n.classes.has('view--rezka-source'))
  };
}

test('card is red and immediately follows native Play (no focus stealing)',()=>{
  const h=setup();h.emit();
  assert.deepEqual(h.visibleItems(),['Смотреть','HDREZKA']);
  assert.match(h.styles[0].textContent,/#d63840/);
  assert.doesNotMatch(h.styles[0].textContent,/order:-1/);
  assert.ok(!h.card().classes.has('hide'));
  assert.ok(h.card().handlers['hover:enter']);
  h.card().handlers['hover:enter']();
  assert.equal(h.pushes.at(-1).component,'rezka_online');
});

test('source is a native item immediately after Continue and before Online',()=>{
  const h=setup();h.emit();
  assert.deepEqual(h.sourceItems(),['Торренты','Продолжить · С1Е3 · с начала',
    'HDREZKA','Онлайн','Трейлеры']);
  assert.match(h.source().markup,/#c62828/);
  h.source().handlers['hover:enter']();
  assert.equal(h.pushes.at(-1).component,'rezka_online');
  h.runTimers();
  assert.equal(h.sources.items.filter(n=>n.classes.has('view--rezka-source')).length,1);
});

test('both placements use matching vector HD letters rather than Play triangles',()=>{
  const h=setup();h.emit();
  const card=h.card().markup;
  const source=h.source().markup;
  const glyph='M4 7v10M4 12h6M10 7v10M14 7h2a5 5 0 0 1 0 10h-2V7z';
  assert.ok(card.includes(glyph));
  assert.ok(source.includes(glyph));
  assert.match(card,/stroke="currentColor"/);
  assert.match(source,/stroke="#fff"/);
  assert.match(source,/fill="#c62828"/);
  assert.match(card,/class="button__icon"/);
  assert.match(source,/class="rezka-source-icon"/);
  assert.doesNotMatch(card,/M9 6\.5l9 5\.5-9 5\.5/);
  assert.doesNotMatch(source,/M10 7l7 5-7 5/);
});

test('independent settings hide either location without hiding the other',()=>{
  const h=setup();h.emit();
  const cardField=h.fields.find(f=>f.param.name==='rezka_show_card_button');
  const sourceField=h.fields.find(f=>f.param.name==='rezka_show_source_button');
  assert.ok(cardField&&sourceField);
  assert.equal(cardField.param.default,true);
  assert.equal(sourceField.param.default,true);
  cardField.onChange(false);
  assert.equal(h.storage.rezka_show_card_button,false);
  assert.ok(h.card().classes.has('hide'));
  assert.ok(!h.source().classes.has('hide'));
  sourceField.onChange(false);
  assert.ok(h.source().classes.has('hide'));
  cardField.onChange('true');
  assert.ok(!h.card().classes.has('hide'));
  assert.ok(h.source().classes.has('hide'));
});

test('both controls can be hidden from first render and repeated full events do not duplicate',()=>{
  const h=setup({card:false,source:false});h.emit();h.emit();
  assert.equal(h.row.items.filter(n=>n.classes.has('view--rezka')).length,1);
  assert.equal(h.sources.items.filter(n=>n.classes.has('view--rezka-source')).length,1);
  assert.ok(h.card().classes.has('hide'));
  assert.ok(h.source().classes.has('hide'));
});

test('source moves after a Continue entry added by another plugin later',()=>{
  const h=setup({continueButton:false});h.emit();
  assert.deepEqual(h.sourceItems(),['Торренты','HDREZKA','Онлайн','Трейлеры']);
  h.addLateContinue();
  h.runTimers();
  assert.deepEqual(h.sourceItems(),['Торренты','Продолжить · С1Е3 · с начала',
    'HDREZKA','Онлайн','Трейлеры']);
});

test('classic card layout falls back to the native Play anchor',()=>{
  const h=setup({modern:false});h.emit();
  assert.deepEqual(h.visibleItems(),['Смотреть','HDREZKA']);
});
