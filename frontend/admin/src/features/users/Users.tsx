import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { services } from "../../services/api";
import { Card, Empty, Field, Pagination, SelectField } from "../../components/UI";
import { formatDateTime } from "../../lib/format";
import usersModuleIcon from "../../assets/figma/modules/users.svg";
const ranges = [["all","All time"],["7d","Last 7 days"],["30d","Last 30 days"],["90d","Last 90 days"]] as const;
export function Users() {
  const [q,setQ]=useState(""),[createdRange,setCreatedRange]=useState("all"),[page,setPage]=useState(1); const pageSize=20;
  const {data}=useQuery({queryKey:["users",q,createdRange,page],queryFn:()=>services.users.list(q,page,pageSize,createdRange)});
  useEffect(()=>setPage(1),[q,createdRange]); const result=data??{items:[],total:0,page:1,pageSize};
  return <div className="page users-page"><div className="page-hero"><span className="page-icon"><img src={usersModuleIcon} alt="" /></span><div><h1>User Directory</h1><p>View app users and registration dates.</p></div></div>
    <Card className="filters"><Field label="" placeholder="Search by username..." value={q} onChange={e=>setQ(e.target.value)}/><SelectField label="REGISTERED" value={createdRange} onChange={e=>setCreatedRange(e.target.value)}>{ranges.map(([v,l])=><option key={v} value={v}>{l}</option>)}</SelectField></Card>
    <Card className="table-card"><div className="table-heading"><h2>Accounts</h2><p>Showing {result.total} users</p></div><div className="table-wrap"><table><thead><tr><th>Username</th><th>Registered On</th></tr></thead><tbody>{result.items.map(u=><tr key={u.id}><td><strong>{u.username}</strong></td><td>{formatDateTime(u.createdAt)}</td></tr>)}</tbody></table>{!result.items.length&&<Empty>No users found.</Empty>}</div><Pagination total={result.total} page={page} pageSize={pageSize} onChange={setPage}/></Card></div>;
}
