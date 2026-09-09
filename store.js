import fs from "node:fs";
import path from "node:path";
export class Store {
  constructor(file){this.file=file;fs.mkdirSync(path.dirname(file),{recursive:true});if(!fs.existsSync(file))fs.writeFileSync(file,"[]")}
  read(){try{return JSON.parse(fs.readFileSync(this.file,"utf8"))}catch{return[]}}
  saveSignal(s){
    const a=this.read();
    const key=`${s.mint}:${Math.floor(Date.parse(s.observedAt)/60000)}`;
    if(a.some(x=>x.key===key))return;
    a.push({key,...s});
    fs.writeFileSync(this.file,JSON.stringify(a.slice(-5000),null,2));
  }
  signals(n){return this.read().slice(-n).reverse()}
}
