import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { services } from "../../services/api";
import { Badge, Button, Card, Empty, Field, Modal, Pagination, SelectField } from "../../components/UI";
import type { AuditEntry } from "../../types";
import { auditEntries } from "../../services/mockData";
import logsModuleIcon from "../../assets/figma/modules/logs.svg";
const dates=[["all","All Dates"],["today","Today"],["7d","Last 7 days"],["30d","Last 30 days"]];
const actors=[...new Set(auditEntries.map((entry)=>entry.actor))].sort();
export function Logs() {
 const [q,setQ]=useState(""),[category,setCategory]=useState("all"),[actor,setActor]=useState(""),[date,setDate]=useState("all"),[page,setPage]=useState(1),[detail,setDetail]=useState<AuditEntry|null>(null); const pageSize=20;
 const {data}=useQuery({queryKey:["logs",category,q,actor,date,page],queryFn:()=>services.logs.list(category==="all"?"All":category,q,actor||"All Actors",date,page,pageSize)});
 useEffect(()=>setPage(1),[q,category,actor,date]); const result=data??{items:[],total:0,page:1,pageSize};
 return <div className="page"><div className="page-hero"><span className="page-icon"><img src={logsModuleIcon} alt="" /></span><div><h1>System Logs</h1><p>Review administrator changes and user activity across KUMPAS.</p></div></div>
 <Card className="filters logs-filters"><Field label="" placeholder="Search actions, actors, or targets..." value={q} onChange={e=>setQ(e.target.value)}/><SelectField label="ACTOR" value={actor} onChange={e=>setActor(e.target.value)}><option value="">All Actors</option>{actors.map((value)=><option key={value} value={value}>{value}</option>)}</SelectField><SelectField label="DATE" value={date} onChange={e=>setDate(e.target.value)}>{dates.map(([v,l])=><option key={v} value={v}>{l}</option>)}</SelectField></Card>
 <Card className="table-card"><div className="tabs"><button className={category==="all"?"active":""} onClick={()=>setCategory("all")}>All Logs</button><button className={category==="Admin"?"active":""} onClick={()=>setCategory("Admin")}>Admin Activity</button><button className={category==="User"?"active":""} onClick={()=>setCategory("User")}>User Activity</button></div><div className="table-wrap"><table><thead><tr><th>Activity</th><th>Actor</th><th>Target</th><th>Date &amp; Time</th><th>Action</th></tr></thead><tbody>{result.items.map(l=><tr key={l.id}><td><strong>{l.action}</strong><small>{l.category} activity</small></td><td>{l.actor}</td><td>{l.target}</td><td>{l.createdAt}</td><td><button className="text-action" onClick={()=>setDetail(l)}>View Details</button></td></tr>)}</tbody></table>{!result.items.length&&<Empty>No logs found.</Empty>}</div><Pagination total={result.total} page={page} pageSize={pageSize} onChange={setPage}/></Card>
 {detail&&<Modal title="Log Details" subtitle="Detailed audit event metadata." size="md" variant="green" onClose={()=>setDetail(null)}><Badge tone="green">{detail.category} Activity</Badge><div className="detail-grid"><span>ACTIVITY</span><strong>{detail.action}</strong><span>ACTOR</span><strong>{detail.actor}</strong><span>TARGET</span><strong>{detail.target}</strong><span>DATE &amp; TIME</span><strong>{detail.createdAt}</strong></div>{detail.detail&&<p>{detail.detail}</p>}<div className="modal-actions"><Button variant="subtle" onClick={()=>setDetail(null)}>Close</Button></div></Modal>}</div>;
}
