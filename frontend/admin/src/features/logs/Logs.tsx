import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { services } from "../../services/api";
import { Badge, Button, Card, Empty, Field, LoadingState, Modal, Pagination, ProgressBar, Stamp, TimeZoneTag } from "../../components/UI";
import { FilterCombobox } from "../../components/FilterCombobox";
import { demotionReasonLabel } from "../../lib/demotionReasons";
import type { AuditEntry } from "../../types";
import { PageIcon } from "../../components/PageIcon";
import { useDebouncedValue } from "../../lib/useDebouncedValue";
const dates=[{id:"today",name:"Today"},{id:"7d",name:"Last 7 days"},{id:"30d",name:"Last 30 days"}];
/** The tabs: everything, or one category of the audit trail (the server's own category names). */
type LogCategory="all"|"Admin"|"User"|"System";
export function Logs() {
 // User Management links here with ?q=<username>&category=User to show one account's activity.
 const [searchParams]=useSearchParams();
 const [q,setQ]=useState(()=>searchParams.get("q")??""),[category,setCategory]=useState<LogCategory>(()=>{const requested=searchParams.get("category");return requested==="Admin"||requested==="User"||requested==="System"?requested:"all";}),[date,setDate]=useState("all"),[page,setPage]=useState(1),[detail,setDetail]=useState<AuditEntry|null>(null); const pageSize=10;
 // The search waits for typing to pause so a word is one request, not one per key.
 const searchQ=useDebouncedValue(q);
 const {data,isFetching,isPlaceholderData}=useQuery({queryKey:["logs",category,searchQ,date,page],queryFn:()=>services.logs.list(category==="all"?"All":category,searchQ,"All Actors",date,page,pageSize),placeholderData:previous=>previous});
 // Reset on the settled search too: a page chosen while it settled belongs to the old results.
 useEffect(()=>setPage(1),[q,searchQ,category,date]);
 useEffect(()=>{if(data&&!isPlaceholderData)setPage(current=>Math.min(current,Math.max(1,Math.ceil(data.total/pageSize))));},[data,isPlaceholderData]); const result=data??{items:[],total:0,page:1,pageSize};
 // A search with nothing to show says which account or term had no activity, and offers to clear the filters that narrowed it.
 const searched=searchQ.trim();
 const clearFilters=()=>{setQ("");setCategory("all");};
 return <div className="page"><div className="page-hero"><PageIcon name="logs" /><div><h1>System Logs</h1><p>Review administrator changes and user activity across KUMPAS.</p></div></div>
 <Card className="filters logs-filters"><Field className="filters-search" label="SEARCH LOGS" placeholder="Search actions, actors, or targets..." value={q} onChange={e=>setQ(e.target.value)}/><FilterCombobox label="DATE" noun="dates" allLabel="All Dates" searchable={false} options={dates} value={date==="all"?null:date} onChange={id=>setDate(id??"all")}/></Card>
 <Card className="table-card"><div className="tabs"><button className={category==="all"?"active":""} aria-pressed={category==="all"} onClick={()=>setCategory("all")}>All Logs</button><button className={category==="Admin"?"active":""} aria-pressed={category==="Admin"} onClick={()=>setCategory("Admin")}>Admin Activity</button><button className={category==="User"?"active":""} aria-pressed={category==="User"} onClick={()=>setCategory("User")}>User Activity</button><button className={category==="System"?"active":""} aria-pressed={category==="System"} onClick={()=>setCategory("System")}>System Activity</button></div><ProgressBar active={isFetching}/><div className="table-wrap"><table><thead><tr><th>Activity</th><th>Actor</th><th>Target</th><th>Date &amp; Time <TimeZoneTag/></th><th>Action</th></tr></thead><tbody>{result.items.map(l=><tr key={l.id}><td><strong>{l.action}</strong><small>{l.category} activity</small></td><td>{l.actor}</td><td>{l.target}</td><td><Stamp value={l.createdAt}/></td><td><button className="text-action" onClick={()=>setDetail(l)}>View Details</button></td></tr>)}</tbody></table>{isFetching ? <LoadingState size={20}>Loading logs…</LoadingState> : !result.items.length&&(searched?<Empty><p>No activity recorded for {searched} yet.</p><Button variant="subtle" onClick={clearFilters}>Clear filters</Button></Empty>:<Empty>No logs found.</Empty>)}</div><Pagination total={result.total} page={page} pageSize={pageSize} onChange={setPage}/></Card>
 {detail&&<Modal title="Log Details" subtitle="Detailed audit event metadata." size="md" variant="green" onClose={()=>setDetail(null)}><div className="log-detail-head"><Badge tone="green">{detail.category} Activity</Badge><h3>{detail.action}</h3></div>{detail.detail&&<p className="log-detail-text">{detail.detail}</p>}<dl className="detail-list"><dt>Actor</dt><dd>{detail.actor}</dd><dt>Target</dt><dd>{detail.target}</dd><dt>Date &amp; time</dt><dd><Stamp value={detail.createdAt}/> <TimeZoneTag/></dd></dl>{!!detail.reasons?.length&&<div className="log-reasons"><strong>Reasons</strong><ul>{detail.reasons.map(code=><li key={code}>{demotionReasonLabel(code)}</li>)}</ul>{detail.otherReason&&<p><strong>Explanation:</strong> <span className="log-other-reason">{detail.otherReason}</span></p>}</div>}<div className="modal-actions"><Button variant="subtle" onClick={()=>setDetail(null)}>Close</Button></div></Modal>}</div>;
}
