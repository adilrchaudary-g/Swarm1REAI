export type Role = 'admin' | 'caller'

export type Permission =
  | 'view:call_list'
  | 'view:dial_mode'
  | 'view:recordings'
  | 'view:own_kpi'
  | 'view:pipeline'
  | 'view:contracts'
  | 'view:distressed'
  | 'view:sources'
  | 'view:markets'
  | 'view:underwriting'
  | 'view:kpi'
  | 'view:agents'
  | 'action:log_call'
  | 'action:add_note'
  | 'action:upload_recording'
  | 'view:schedule'
  | 'view:activity'
  | 'view:finances'
  | 'action:manage_leads'
  | 'action:manage_users'
  | '*'

export const CALLER_PERMISSIONS: Permission[] = [
  'view:call_list',
  'view:dial_mode',
  'view:own_kpi',
  'view:kpi',
  'view:schedule',
  'action:log_call',
  'action:add_note',
  'action:upload_recording',
]

export const ADMIN_PERMISSIONS: Permission[] = ['*']

export function hasPermission(userPermissions: string[], perm: Permission): boolean {
  return userPermissions.includes('*') || userPermissions.includes(perm)
}

export function hasAnyPermission(userPermissions: string[], perms: Permission[]): boolean {
  return userPermissions.includes('*') || perms.some((p) => userPermissions.includes(p))
}
