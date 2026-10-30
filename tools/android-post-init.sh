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
# Widget + quick-settings tile resources.
cp -R "$ROOT"/src-tauri/android-plugin/res/. "$A/src/main/res/"
# Manifest: default-browser intent filters, share target, hush: links, PiP, permissions, widget, tile.
python3 - "$A/src/main/AndroidManifest.xml" <<'PY'
import re,sys
p=sys.argv[1]; s=open(p).read()
perms=["CAMERA","RECORD_AUDIO","MODIFY_AUDIO_SETTINGS","ACCESS_FINE_LOCATION","ACCESS_COARSE_LOCATION"]
for x in perms:
    if f'android.permission.{x}"' not in s:
        s=re.sub(r'(<manifest[^>]*>)',r'\1\n    <uses-permission android:name="android.permission.'+x+'" />',s,count=1)
m=re.search(r'<activity\b[^>]*>',s)
tag=m.group(0); new=tag
for k,v in [("android:launchMode","singleTask"),("android:supportsPictureInPicture","true")]:
    if k not in new: new=new.replace("<activity",f'<activity {k}="{v}"',1)
if "android:configChanges" not in new:
    new=new.replace("<activity",'<activity android:configChanges="orientation|screenSize|smallestScreenSize|screenLayout|keyboardHidden|uiMode"',1)
filters="""
            <intent-filter><action android:name="android.intent.action.VIEW" /><category android:name="android.intent.category.DEFAULT" /><category android:name="android.intent.category.BROWSABLE" /><data android:scheme="http" /><data android:scheme="https" /></intent-filter>
            <intent-filter><action android:name="android.intent.action.VIEW" /><category android:name="android.intent.category.DEFAULT" /><category android:name="android.intent.category.BROWSABLE" /><data android:scheme="hush" /></intent-filter>
            <intent-filter><action android:name="android.intent.action.SEND" /><category android:name="android.intent.category.DEFAULT" /><data android:mimeType="text/plain" /></intent-filter>
            <intent-filter><action android:name="android.intent.action.WEB_SEARCH" /><category android:name="android.intent.category.DEFAULT" /></intent-filter>"""
if 'android:scheme="hush"' not in s: new=new+filters
s=s.replace(tag,new,1)
if "HushWidget" not in s:
    s=s.replace("</application>","""        <receiver android:name="app.hush.browser.HushWidget" android:exported="true" android:label="Hush search">
            <intent-filter><action android:name="android.appwidget.action.APPWIDGET_UPDATE" /></intent-filter>
            <meta-data android:name="android.appwidget.provider" android:resource="@xml/hush_widget_info" />
        </receiver>
        <service android:name="app.hush.browser.HushTile" android:exported="true" android:label="Private tab" android:icon="@mipmap/ic_launcher"
            android:permission="android.permission.BIND_QUICK_SETTINGS_TILE">
            <intent-filter><action android:name="android.service.quicksettings.action.QS_TILE" /></intent-filter>
        </service>
    </application>""",1)
open(p,'w').write(s); print("manifest: browser filters, PiP, widget, tile ok")
PY
# Signing: when HUSH_KEYSTORE is set (CI), debug builds are signed with Hush's permanent key so updates install in place.
grep -q 'create("hush")' "$A/build.gradle.kts" || cat >> "$A/build.gradle.kts" <<'SIGN'

android {
    signingConfigs {
        create("hush") {
            val ks = System.getenv("HUSH_KEYSTORE")
            if (ks != null) { storeFile = file(ks); storePassword = System.getenv("HUSH_KEYSTORE_PASSWORD") ?: "hushdebug"
                keyAlias = "hush"; keyPassword = System.getenv("HUSH_KEYSTORE_PASSWORD") ?: "hushdebug" }
        }
    }
    buildTypes { getByName("debug") { if (System.getenv("HUSH_KEYSTORE") != null) signingConfig = signingConfigs.getByName("hush") } }
}
SIGN
echo "Android plugin installed. Next: cd src-tauri && cargo tauri android build --debug --apk --target aarch64"
