import test from 'node:test';
import assert from 'node:assert/strict';
import {NavigationHistory} from '../src/navigation-history.mjs';
test('nested playlist navigation restores page, selection and viewport without stale references',()=>{
 const history=new NavigationHistory();
 const page={view:'playlists',page:3,section:'recommend',lists:[{title:'Selected playlist'}]};
 history.push(page,{selected:12,offset:7});
 page.lists[0].title='changed';
 history.push({view:'browse',page:2,section:'discover'},{selected:5,offset:4});
 assert.deepEqual(history.pop(),{view:'browse',page:2,section:'discover',selected:5,offset:4});
 assert.deepEqual(history.pop(),{view:'playlists',page:3,section:'recommend',lists:[{title:'Selected playlist'}],selected:12,offset:7});
 assert.equal(history.pop(),undefined);
});
test('navigation history is bounded and cleared on account changes',()=>{
 const history=new NavigationHistory();
 for(let page=0;page<40;page++)history.push({page});
 for(let page=39;page>=8;page--)assert.equal(history.pop().page,page);
 assert.equal(history.pop(),undefined);
 history.push({page:1});history.clear();assert.equal(history.pop(),undefined);
});
