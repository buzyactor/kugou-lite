import test from 'node:test';import assert from 'node:assert/strict';
import {searchSuggestions,hotSearches} from '../src/search-suggestions.mjs';
test('search suggestions deduplicate, sanitize and cap at sixteen without MV entries',()=>{
 const body={data:[{LableName:'MV',RecordDatas:[{HintInfo:'Excluded'}]},{LableName:'歌曲',RecordDatas:[{HintInfo:'<b>周杰伦</b>'},{HintInfo:'周杰伦'},...Array.from({length:20},(_,i)=>({HintInfo:'歌曲'+i}))]},{LableName:'歌手',RecordDatas:[{HintInfo:'Other'}]}]};
 assert.deepEqual(searchSuggestions(body),['周杰伦',...Array.from({length:15},(_,i)=>'歌曲'+i)]);
 assert.deepEqual(searchSuggestions({data:[{RecordDatas:[{HintInfo:'\x1bControl'},{}]}]}),['Control']);
 assert.deepEqual(searchSuggestions({}),[]);
});

test('hot search uses the official hot ranking order, deduplicates and excludes other charts',()=>{
 assert.deepEqual(hotSearches({data:{list:[{name:'飙升榜',keywords:[{keyword:'Other'}]},{name:'热搜榜',keywords:[{keyword:'<b>First</b>'},{keyword:'First'},{keyword:'Second'},{}]}]}}),['First','Second']);
 assert.deepEqual(hotSearches({}),[]);
});
