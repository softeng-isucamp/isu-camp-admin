export const cx = (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' ')
export const nowLabel = () => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date())
