'use strict';
class ChineseFilePicker {
  constructor(){
    this.current=null;this.pending=null;this.sequence=0;this.loading=false;this.acting=false;
    $('filesClose').onclick=()=>this.cancel();$('filesCancel').onclick=()=>this.cancel();
    $('filesDialog').addEventListener('cancel',e=>{e.preventDefault();this.cancel();});
    $('filesGo').onclick=()=>this.browse($('filesPath').value);$('filesPath').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();this.browse($('filesPath').value);}};
    $('filesUp').onclick=()=>{if(this.current?.parent)this.browse(this.current.parent);};
    $('filesRefresh').onclick=()=>this.browse(this.current?.directory);
    $('filesFind').onclick=()=>this.browse(this.current?.directory);
    $('filesSearch').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();this.browse(this.current?.directory);}};
    $('filesHidden').onchange=()=>this.browse(this.current?.directory);
    $('filesType').onchange=()=>this.browse(this.current?.directory);
    $('filesPrevious').onclick=()=>this.browse(this.current?.directory,Math.max(0,this.current.offset-200));
    $('filesNext').onclick=()=>{if(this.current.offset+200<this.current.total)this.browse(this.current.directory,this.current.offset+200);};
    $('filesAccept').onclick=()=>this.accept();$('filesName').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();this.accept();}};
    $('filesName').oninput=()=>this.selectedEntry=null;
    $('filesNewFolder').onclick=()=>{$('filesCreateRow').hidden=false;$('filesFolderName').value='';$('filesFolderName').focus();};
    $('filesFolderCancel').onclick=()=>$('filesCreateRow').hidden=true;
    $('filesFolderCreate').onclick=()=>this.mkdir();$('filesFolderName').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();this.mkdir();}};
  }
  open(kind,extra={}){
    if(busy||this.pending)return Promise.resolve(null);
    player.cancel();this.kind=kind;this.extra=extra;this.current=null;this.loading=false;this.acting=false;
    $('filesHeading').textContent='选择文件';$('filesStatus').textContent='正在读取文件夹…';$('filesPath').value='';$('filesName').value='';$('filesSearch').value='';$('filesHidden').checked=false;$('filesCreateRow').hidden=true;
    $('filesRows').replaceChildren();$('filesLocations').replaceChildren();$('filesBreadcrumbs').replaceChildren();$('filesType').replaceChildren();
    $('filesDialog').showModal();const promise=new Promise(resolve=>this.pending=resolve);this.browse();return promise;
  }
  finish(result){const resolve=this.pending;this.pending=null;this.sequence++;this.current=null;this.loading=false;$('filesDialog').close();resolve?.(result);}
  cancel(){if(!this.acting)this.finish(null);}
  lock(value){this.loading=value;for(const c of $('filesDialog').querySelectorAll('button,input,select'))if(!['filesClose','filesCancel'].includes(c.id))c.disabled=value;}
  async browse(directory,offset=0){
    if(this.acting||!this.pending)return;const sequence=++this.sequence,initial=!this.current,changed=directory&&directory!==this.current?.directory;
    this.lock(true);$('filesStatus').textContent='正在读取文件夹…';
    try{
      const result=await api('files:list',{kind:this.kind,directory,offset,filter:Number($('filesType').value)||0,query:changed?'':$('filesSearch').value,hidden:$('filesHidden').checked});
      if(sequence!==this.sequence||!this.pending)return;
      this.current=result;this.selectedEntry=null;$('filesHeading').textContent=result.title;$('filesAccept').textContent=result.save?'保存':'打开';$('filesPath').value=result.directory;
      if(changed)$('filesSearch').value='';if(initial||result.selectedFile)$('filesName').value=result.name||'';else if(changed&&!result.save)$('filesName').value='';
      options($('filesType'),result.filters.map((f,i)=>({id:i,name:f.label})),result.filter);
      this.render();$('filesStatus').textContent=result.total?`共 ${result.total} 项 · 双击文件夹进入，双击文件${result.save?'选定':'打开'}`:'这个文件夹没有符合条件的文件。可更换文件类型或位置。';
    }catch(error){if(sequence===this.sequence)$('filesStatus').textContent=error.message;}
    finally{if(sequence===this.sequence)this.lock(false);}
  }
  render(){
    const value=this.current,locations=$('filesLocations'),crumbs=$('filesBreadcrumbs'),rows=$('filesRows');locations.replaceChildren();crumbs.replaceChildren();rows.replaceChildren();
    for(const item of value.locations){const b=document.createElement('button');b.textContent=item.name;b.title=item.directory;b.className='file-location';b.onclick=()=>this.browse(item.directory);locations.append(b);}
    for(const item of value.breadcrumbs){const b=document.createElement('button');b.textContent=item.name;b.title=item.directory;b.onclick=()=>this.browse(item.directory);crumbs.append(b);}
    for(const item of value.entries){
      const tr=document.createElement('tr');tr.tabIndex=0;tr.dataset.name=item.name;
      const type=item.directory?'文件夹':item.name.includes('.')?item.name.split('.').at(-1).toUpperCase()+' 文件':'文件';
      const bytes=item.directory?'—':item.bytes<1024?`${item.bytes} 字节`:item.bytes<1048576?`${(item.bytes/1024).toFixed(1)} 千字节`:`${(item.bytes/1048576).toFixed(1)} 兆字节`;
      for(const text of [(item.directory?'📁 ':'')+item.name,type,bytes,new Date(item.modified).toLocaleString('zh-CN',{hour12:false})]){const td=document.createElement('td');td.textContent=text;td.title=text;tr.append(td);}
      const select=()=>{for(const r of rows.children)r.classList.toggle('selected',r===tr);this.selectedEntry=item;if(!item.directory||!value.save)$('filesName').value=item.name;};
      const enter=()=>{if(item.directory)this.browse(this.join(value.directory,item.name));else{select();if(!value.save)this.accept();}};
      tr.onclick=select;tr.ondblclick=enter;tr.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();enter();}if(e.key===' '){e.preventDefault();select();}};rows.append(tr);
    }
    $('filesEmpty').hidden=value.entries.length>0;$('filesPage').textContent=value.total?`${value.offset+1}～${Math.min(value.offset+200,value.total)} / ${value.total}`:'0 项';
  }
  join(directory,name){return directory.replace(/[\\/]$/,'')+(directory.includes('\\')?'\\':'/')+name;}
  async accept(){
    if(this.loading||this.acting||!this.current)return;
    if(this.current.save&&this.selectedEntry?.directory){await this.browse(this.join(this.current.directory,this.selectedEntry.name));return;}
    const args={kind:this.kind,directory:this.current.directory,name:$('filesName').value,filter:Number($('filesType').value)||0};this.lock(true);
    try{
      let selected=await api('files:select',args);if(!this.pending)return;
      if(selected.navigate){this.lock(false);await this.browse(selected.navigate);return;}
      if(selected.overwrite){this.lock(false);if(!await confirmAction(`“${selected.file}”已经存在，是否覆盖？`,'覆盖文件'))return;if(!this.pending)return;args.overwrite=true;args.stamp=selected.stamp;this.lock(true);}
      this.acting=true;$('filesStatus').textContent=this.current.save?'正在保存…':'正在读取文件…';
      const result=await act('pick',{...this.extra,...args,file:selected.file});
      this.acting=false;
      if(result?.overwrite){$('filesStatus').textContent='保存期间出现了同名文件，请再次确认覆盖。';return;}
      if(result?.navigate){this.lock(false);await this.browse(result.navigate);return;}
      if(result)this.finish(result);
    }catch(error){$('filesStatus').textContent=error.message;}
    finally{this.acting=false;if(this.pending)this.lock(false);}
  }
  async mkdir(){
    if(this.loading||!this.current)return;this.lock(true);
    try{const result=await api('files:mkdir',{directory:this.current.directory,name:$('filesFolderName').value});$('filesCreateRow').hidden=true;this.lock(false);await this.browse(result.directory);}
    catch(error){$('filesStatus').textContent=error.message;}finally{if(this.pending)this.lock(false);}
  }
}
const filePicker=new ChineseFilePicker();
