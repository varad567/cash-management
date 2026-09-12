declare const Deno: { env: { get(name: string): string | undefined }; serve(handler: (request: Request) => Response | Promise<Response>): void; };
declare module 'jsr:@supabase/supabase-js@2' { export const createClient: typeof import('@supabase/supabase-js').createClient; }
