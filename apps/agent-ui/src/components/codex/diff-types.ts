export interface FileChange {
  filename: string
  action: 'created' | 'modified' | 'deleted'
  additions?: number
  deletions?: number
  patch?: string
}
