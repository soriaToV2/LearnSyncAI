<#
.SYNOPSIS
  Clones the LearnSyncAI Supabase database (schema + all data, including auth users)
  into a second, EMPTY Supabase project.

.DESCRIPTION
  Wraps the Supabase-documented dump/restore flow:

    supabase db dump --role-only     -> roles.sql
    supabase db dump                 -> schema.sql
    supabase db dump --data-only     -> data.sql
    psql --single-transaction --file roles.sql --file schema.sql
         --command 'SET session_replication_role = replica' --file data.sql

  session_replication_role = replica is load-bearing: it disables triggers during the
  data load. Without it handle_new_user() fires on every restored auth.users row and
  writes a SECOND profiles row (which then collides), and trigger_update_streak
  recomputes day_streak / total_study_hours from the replayed activity_logs.

  The restore runs inside a single transaction with ON_ERROR_STOP=1, so any failure
  rolls the target back to empty. Nothing is ever written to the SOURCE.

.PARAMETER SourceUrl
  Session-pooler connection string of the LIVE project (read only).
  Supabase dashboard -> Connect -> Session pooler. Port 5432, user postgres.<ref>.

.PARAMETER TargetUrl
  Session-pooler connection string of the NEW, EMPTY project.

.PARAMETER OutDir
  Where the three .sql dumps are written. Defaults to a timestamped folder under
  $env:TEMP. NEVER put these in the repo: data.sql contains auth.users, i.e. every
  student's bcrypt password hash.

.PARAMETER SkipRoles
  Skip roles.sql. Use this if the restore fails with "role ... already exists".
  This project defines no custom database roles, so skipping is normally harmless.

.PARAMETER DumpOnly
  Produce the dumps and stop. Nothing touches the target.

.EXAMPLE
  ./scripts/clone-supabase.ps1 `
    -SourceUrl "postgresql://postgres.aaaa:PW@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres" `
    -TargetUrl "postgresql://postgres.bbbb:PW@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres"
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [string] $SourceUrl,
    [Parameter(Mandatory = $false)] [string] $TargetUrl,
    [string] $OutDir = (Join-Path $env:TEMP ("supabase-clone-" + (Get-Date -Format "yyyyMMdd-HHmmss"))),
    [switch] $SkipRoles,
    [switch] $DumpOnly
)

$ErrorActionPreference = 'Stop'

function Fail($msg) { Write-Host "`nFAILED: $msg" -ForegroundColor Red; exit 1 }
function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }

if (-not $DumpOnly -and -not $TargetUrl) { Fail "-TargetUrl is required unless -DumpOnly is set." }

# --- preflight -------------------------------------------------------------

if (-not (Get-Command psql -ErrorAction SilentlyContinue)) {
    Fail @"
psql not found on PATH.

Install the PostgreSQL 17 client tools, then reopen the terminal:

    winget install -e --id PostgreSQL.PostgreSQL.17

(In the installer you only need 'Command Line Tools'. Afterwards add
 C:\Program Files\PostgreSQL\17\bin to PATH if winget did not.)
"@
}

$pgDumpVersion = (& pg_dump --version) -replace '[^\d.]', ''
Write-Host "pg_dump $pgDumpVersion  (source server is PostgreSQL 17.6 — the client must be >= 17)"
if ([int]($pgDumpVersion.Split('.')[0]) -lt 17) {
    Fail "pg_dump is older than the server. Install PostgreSQL 17 client tools."
}

if ($SourceUrl -eq $TargetUrl) { Fail "SourceUrl and TargetUrl are identical. Refusing to run." }
foreach ($u in @($SourceUrl, $TargetUrl)) {
    if ($u -and $u -notmatch '^postgres(ql)?://') { Fail "Not a Postgres connection string: $u" }
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$roles  = Join-Path $OutDir 'roles.sql'
$schema = Join-Path $OutDir 'schema.sql'
$data   = Join-Path $OutDir 'data.sql'

Write-Host "Dump directory: $OutDir"

# --- 1. dump ---------------------------------------------------------------

$sb = @('--yes', 'supabase@latest')

Step "Dumping roles"
& npx @sb db dump --db-url $SourceUrl -f $roles --role-only
if (-not $?) { Fail "roles dump failed" }

Step "Dumping schema"
& npx @sb db dump --db-url $SourceUrl -f $schema
if (-not $?) { Fail "schema dump failed" }

Step "Dumping data (this is the slow one)"
& npx @sb db dump --db-url $SourceUrl -f $data --use-copy --data-only `
    -x "storage.buckets_vectors" -x "storage.vector_indexes"
if (-not $?) { Fail "data dump failed" }

foreach ($f in @($roles, $schema, $data)) {
    $kb = [math]::Round((Get-Item $f).Length / 1KB, 1)
    Write-Host ("  {0,-12} {1,10} KB" -f (Split-Path $f -Leaf), $kb)
}

if ($DumpOnly) {
    Write-Host "`nDump complete. Nothing was written to a target." -ForegroundColor Green
    Write-Host "Files: $OutDir"
    exit 0
}

# --- 2. restore ------------------------------------------------------------

Step "Restoring into target (single transaction — rolls back entirely on any error)"

$psqlArgs = @('--single-transaction', '--variable', 'ON_ERROR_STOP=1', '--no-psqlrc')
if (-not $SkipRoles) { $psqlArgs += @('--file', $roles) }
$psqlArgs += @(
    '--file', $schema,
    '--command', 'SET session_replication_role = replica',
    '--file', $data,
    '--dbname', $TargetUrl
)

& psql @psqlArgs
if ($LASTEXITCODE -ne 0) {
    Fail @"
Restore failed and was rolled back — the target is unchanged.

If the error was 'role "..." already exists', re-run with -SkipRoles.
The dumps are kept at: $OutDir
"@
}

# --- 3. verify -------------------------------------------------------------

Step "Comparing row counts"

$countSql = @'
SELECT 'auth.users' AS t, count(*) FROM auth.users
UNION ALL SELECT 'profiles', count(*) FROM public.profiles
UNION ALL SELECT 'materials', count(*) FROM public.materials
UNION ALL SELECT 'concepts', count(*) FROM public.concepts
UNION ALL SELECT 'concepts_with_embedding', count(*) FROM public.concepts WHERE embedding IS NOT NULL
UNION ALL SELECT 'study_spaces', count(*) FROM public.study_spaces
UNION ALL SELECT 'flashcards', count(*) FROM public.flashcards
UNION ALL SELECT 'bkt_mastery', count(*) FROM public.bkt_mastery
UNION ALL SELECT 'bkt_update_logs', count(*) FROM public.bkt_update_logs
UNION ALL SELECT 'bkt_parameters', count(*) FROM public.bkt_parameters
UNION ALL SELECT 'practice_tests', count(*) FROM public.practice_tests
UNION ALL SELECT 'practice_telemetry', count(*) FROM public.practice_telemetry
UNION ALL SELECT 'cognitive_logs', count(*) FROM public.cognitive_logs
UNION ALL SELECT 'activity_logs', count(*) FROM public.activity_logs
UNION ALL SELECT 'game_sessions', count(*) FROM public.game_sessions
UNION ALL SELECT 'user_badges', count(*) FROM public.user_badges
UNION ALL SELECT 'subjects', count(*) FROM public.subjects
ORDER BY 1
'@

$tmp = Join-Path $OutDir 'counts.sql'
Set-Content -Path $tmp -Value $countSql -Encoding utf8

$srcCounts = & psql --no-psqlrc -At -F '|' -f $tmp -d $SourceUrl
$tgtCounts = & psql --no-psqlrc -At -F '|' -f $tmp -d $TargetUrl

$src = @{}; foreach ($l in $srcCounts) { if ($l) { $p = $l.Split('|'); $src[$p[0]] = $p[1] } }
$tgt = @{}; foreach ($l in $tgtCounts) { if ($l) { $p = $l.Split('|'); $tgt[$p[0]] = $p[1] } }

$bad = 0
Write-Host ""
Write-Host ("{0,-26} {1,>8} {2,>8}  " -f 'table', 'source', 'clone')
foreach ($k in ($src.Keys | Sort-Object)) {
    $ok = $src[$k] -eq $tgt[$k]
    if (-not $ok) { $bad++ }
    $mark = if ($ok) { 'ok' } else { 'MISMATCH' }
    Write-Host ("{0,-26} {1,8} {2,8}  {3}" -f $k, $src[$k], $tgt[$k], $mark) `
        -ForegroundColor $(if ($ok) { 'Gray' } else { 'Red' })
}

Write-Host ""
if ($bad -gt 0) {
    Write-Host "$bad table(s) disagree. Investigate before using the clone as evidence." -ForegroundColor Red
} else {
    Write-Host "Clone complete — every table matches." -ForegroundColor Green
}

Write-Host @"

NEXT
  1. Point a copy of the app at the clone: duplicate .env as .env.clone and replace
     SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_ANON_KEY with the NEW
     project's values (Project Settings -> API). Passwords and usernames are
     unchanged — auth.users came across whole.
  2. Storage FILES are NOT copied. storage.objects rows exist in the clone but the
     uploaded PDFs do not, so opening a material in the clone will 404. Re-upload
     if you need the document viewer.
  3. Turn OFF "Secure email change" in the clone's Auth settings if you plan to
     exercise the email-change flow (see CLAUDE.md, Accounts section).
  4. DELETE the dumps when done — data.sql contains every student's password hash:
       Remove-Item -Recurse -Force "$OutDir"
"@ -ForegroundColor DarkGray
