import type { GenOptions, GenScheme, ShellSpec } from './genvectors'

export interface GenerateSchemeRequest {
  id: number
  shells: ShellSpec[]
  options: GenOptions
}

export type GenerateSchemeResponse =
  | { id: number; ok: true; scheme: GenScheme }
  | { id: number; ok: false; error: string }
