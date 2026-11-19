#!/bin/zsh
# แพตช์ package element-call-ios ให้ build ด้วย Xcode 26 (Swift 6.2) ได้ — Xcode 27 ไม่ต้องใช้
# Swift 6.2 ถือว่า Bundle.module เป็น MainActor ในโมดูลที่ตั้ง defaultIsolation(MainActor) → หา bundle เองแทน
# รันซ้ำได้ (ข้ามถ้าแพตช์แล้ว) · ใช้: ./aranchat/xcode26-patch.sh <derivedDataPath>
set -eu
cd "${0:A:h}/.."
DERIVED="${1:-$PWD/../build/dd}"
PROJ=ElementX.xcodeproj

# ให้ SPM โหลด package ลง derivedData ก่อน (ถ้ายังไม่มี)
CHECKOUT="$DERIVED/SourcePackages/checkouts/element-call-ios"
if [[ ! -d "$CHECKOUT" ]]; then
  xcodebuild -resolvePackageDependencies -project $PROJ -scheme ElementX -derivedDataPath "$DERIVED" >/dev/null
fi

F1="$CHECKOUT/Sources/ElementCallKit/Media/CallSoundEffectRenderer.swift"
if ! grep -q "AranChat" "$F1"; then
  chmod u+w "$F1"
  perl -0pi -e 's/guard let url = Bundle\.module\.url\(forResource: resource,/\/\/ AranChat: Xcode 26 patch\n        let bundle = Bundle.main.url(forResource: "ElementCall_ElementCallKit", withExtension: "bundle").flatMap(Bundle.init(url:)) ?? Bundle.main\n        guard let url = bundle.url(forResource: resource,/' "$F1"
fi

F2="$CHECKOUT/Sources/ElementCallHost/Localization/ElementCallLocalization.swift"
if ! grep -q "AranChat" "$F2"; then
  chmod u+w "$F2"
  perl -0pi -e 's/Bundle\.module\./moduleBundle./g; s/(package static let languageOverride = Mutex<\[String\]\?>\(nil\)\n)/$1    \/\/ AranChat: Xcode 26 patch\n    private static let moduleBundle: Bundle = Bundle.main.url(forResource: "ElementCall_ElementCallHost", withExtension: "bundle").flatMap(Bundle.init(url:)) ?? Bundle.main\n/' "$F2"
fi
echo "▶ Xcode 26 patch: element-call-ios ok"
