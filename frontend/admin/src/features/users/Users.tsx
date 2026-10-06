import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { services } from "../../services/api";
import { Card, Empty, Field, Pagination, SelectField } from "../../components/UI";
import { formatDateTime } from "../../lib/format";
import { accountTypeLabel, accountTypes, parseAccountType } from "../../lib/accountType";
import type { UserAccountType } from "../../types";
import { PageIcon } from "../../components/PageIcon";
const ranges = [["all","All time"],["7d","Last 7 days"],["30d","Last 30 days"],["90d","Last 90 days"]] as const;
export function Users() {
  const [searchParams]=useSearchParams();
  const [q,setQ]=useState(""),[createdRange,setCreatedRange]=useState("all"),[userType,setUserType]=useState<UserAccountType|"all">(()=>parseAccountType(searchParams.get("userType"))??"all"),[page,setPage]=useState(1); const pageSize=10;
  const {data,isFetching}=useQuery({queryKey:["users",q,createdRange,userType,page],queryFn:()=>services.users.list(q,page,pageSize,createdRange,userType)});
  useEffect(()=>setPage(1),[q,createdRange,userType]); const result=data??{items:[],total:0,page:1,pageSize};
  return <div className="page users-page"><div className="page-hero"><PageIcon name="users" /><div><h1>User Directory</h1><p>View app users, their account types, and registration dates.</p></div></div>
    <Card className="filters"><Field label="" placeholder="Search by username..." value={q} onChange={e=>setQ(e.target.value)}/><SelectField label="REGISTERED" value={createdRange} onChange={e=>setCreatedRange(e.target.value)}>{ranges.map(([v,l])=><option key={v} value={v}>{l}</option>)}</SelectField><SelectField label="ACCOUNT TYPE" className="account-type-filter" value={userType} onChange={e=>setUserType(e.target.value as UserAccountType|"all")}><option value="all">All</option>{accountTypes.map(t=><option key={t.key} value={t.key}>{t.label}</option>)}</SelectField></Card>
    <Card className="table-card"><div className="table-heading"><h2>Accounts</h2><p>{isFetching ? "Loading…" : `Showing ${result.total} users`}</p></div><div className="table-wrap"><table><thead><tr><th>Username</th><th>Account Type</th><th>Registered On</th></tr></thead><tbody>{result.items.map(u=><tr key={u.id}><td><strong>{u.username}</strong></td><td>{u.userType?accountTypeLabel(u.userType):"—"}</td><td>{formatDateTime(u.createdAt)}</td></tr>)}</tbody></table>{isFetching ? <div className="empty" role="status">Loading users…</div> : !result.items.length&&<Empty>No users found.</Empty>}</div><Pagination total={result.total} page={page} pageSize={pageSize} onChange={setPage}/></Card></div>;
}
