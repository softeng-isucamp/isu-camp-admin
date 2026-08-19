export type LocationType = 'Building' | 'Floor' | 'Room' | 'Office' | 'Laboratory' | 'Restroom' | 'Facility'
export type RecordStatus = 'Active' | 'Inactive' | 'Open' | 'Closed'
export type Shade = 'Fully Shaded' | 'Mostly Shaded' | 'Partial Shade' | 'Unshaded'
export interface Building { id: string; name: string; code: string; points: [number, number][] }
export interface Location { id: string; name: string; code: string; type: LocationType; parentId: string | null; building?: string; floor?: string; function?: string; keywords?: string; status: RecordStatus; lat: number; lng: number; positioned: boolean }
export interface RouteNode { id: string; name: string; nodeType: 'Entrance' | 'Junction' | 'Access Point'; associatedPlaceId?: string | null; lat: number; lng: number }
export interface Pathway { id: string; name: string; sourceNodeId: string; destinationNodeId: string; distance: string; time: string; shade: Shade; type: string; direction: 'Two-way' | 'One-way'; status: 'Open' | 'Closed'; pathPoints: [number, number][] }
export interface UserAccount { id: string; username: string; createdAt: string; lastSignIn: string | null; role: 'Administrator' | 'Staff' | 'User' }
export interface AuditEntry { id: string; actor: string; action: string; target: string; detail?: string; createdAt: string; category: 'Admin' | 'User' | 'System' }
export interface Session { username: string; role: UserAccount['role'] }
export interface DashboardSummary { buildings: number; offices: number; searches: number; recent: AuditEntry[] }
export interface Page<T> { items: T[]; total: number; page: number; pageSize: number }
