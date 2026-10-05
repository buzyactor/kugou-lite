// A page snapshot includes its cursor and viewport, independently of playback.
export class NavigationHistory {
  #pages=[];
  push(page, focus={selected:0,offset:0}) {
    this.#pages.push(structuredClone({...page,...focus}));
    if(this.#pages.length>32)this.#pages.shift();
  }
  pop(){return this.#pages.pop();}
  clear(){this.#pages=[];}
}
