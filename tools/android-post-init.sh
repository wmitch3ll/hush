#!/bin/sh
# Run AFTER `cargo tauri android init`. Installs our Kotlin plugin into the generated Gradle project,
# adds R8 keep rules and hardens the manifest. Safe to re-run.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; A="$ROOT/src-tauri/gen/android/app"
[ -d "$A" ] || { echo "gen/android not found. Run: cd src-tauri && cargo tauri android init"; exit 1; }
J="$A/src/main/java/app/hush/browser"; mkdir -p "$J"
cp "$ROOT"/src-tauri/android-plugin/*.kt "$J/"
grep -q "app.hush.browser" "$A/proguard-rules.pro" 2>/dev/null || cat >> "$A/proguard-rules.pro" <<'RULES'
-keep class app.hush.browser.Native { *; }
-keep class app.hush.browser.TabsPlugin { *; }
-keep @app.tauri.annotation.InvokeArg class * { *; }
-keep @app.tauri.annotation.TauriPlugin class * { *; }
-keepclassmembers class * { @app.tauri.annotation.Command <methods>; }
-keepclasseswithmembernames class * { native <methods>; }
-keepattributes SourceFile,LineNumberTable
RULES
python3 - "$A/src/main/AndroidManifest.xml" <<'PY'
import re,sys
p=sys.argv[1]; s=open(p).read()
if 'android.permission.INTERNET' not in s:
    s=re.sub(r'(<manifest[^>]*>)',r'\1\n    <uses-permission android:name="android.permission.INTERNET" />',s,count=1)
if 'android:allowBackup' not in s:
    s=s.replace('<application','<application android:allowBackup="false"',1)
open(p,'w').write(s); print("manifest ok")
PY
# Libraries the plugin uses: androidx.webkit (private-tab profiles), SwipeRefreshLayout (pull to refresh).
# (Tauri's template already depends on androidx.webkit; add each library only if it's missing.)
for dep in "androidx.webkit:webkit:1.12.1" "androidx.swiperefreshlayout:swiperefreshlayout:1.1.0"; do
  grep -q "${dep%:*}" "$A/build.gradle.kts" || printf '\ndependencies {\n    implementation("%s")\n}\n' "$dep" >> "$A/build.gradle.kts"
done
echo "Android plugin installed. Next: cd src-tauri && cargo tauri android build --debug --apk --target aarch64"
