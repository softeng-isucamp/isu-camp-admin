import type { ButtonHTMLAttributes, HTMLAttributes, PropsWithChildren, InputHTMLAttributes, SelectHTMLAttributes } from 'react'
import { cx } from '../lib/format'
export function Button({ className, variant = 'primary', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'subtle' | 'danger' }) { return <button className={cx('btn', `btn-${variant}`, className)} {...props} /> }
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) { return <div className={cx('card', className)} {...props} /> }
export function Field({ label, ...props }: { label: string } & InputHTMLAttributes<HTMLInputElement>) { return <label className="field"><span>{label}</span><input {...props} /></label> }
export function SelectField({ label, children, ...props }: PropsWithChildren<{ label: string } & SelectHTMLAttributes<HTMLSelectElement>>) { return <label className="field"><span>{label}</span><select {...props}>{children}</select></label> }
export function Badge({ children, tone = 'green' }: PropsWithChildren<{ tone?: string }>) { return <span className={cx('badge', `badge-${tone}`)}>{children}</span> }
export function Empty({ children }: PropsWithChildren) { return <div className="empty">{children}</div> }
export function Modal({ title, children, onClose }: PropsWithChildren<{ title: string; onClose: () => void }>) { return <div className="modal-backdrop"><Card className="modal"><div className="modal-header"><h2>{title}</h2><button className="icon-btn" onClick={onClose}>×</button></div>{children}</Card></div> }
