/** The sole account-pause exception: observation/recording only, no send or paid AI. */
export function monitorsWhileAccountPaused(name:string):boolean {
  return name==="mailbox-sync";
}
