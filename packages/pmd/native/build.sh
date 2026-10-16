#!/bin/bash
# Builds the PMD player to WebAssembly: native/ -> wasm/pmd.js + wasm/pmd.wasm.
# The outputs are committed, so only run this after changing the C sources.
# Needs emcc (tested with 6.0.12).
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
src=$here/98fmplayer
out=$here/../wasm
mkdir -p "$out"
emcc -O3 -flto -std=gnu11 -Wno-unknown-attributes \
  -I"$src" -I"$src/fmdriver" -I"$src/libopna" \
  "$here/pmd_wasm.c" "$here/drums.c" \
  "$src/fmdriver/fmdriver_pmd.c" "$src/fmdriver/fmdriver_common.c" "$src/fmdriver/ppz8.c" \
  "$src/libopna/opna.c" "$src/libopna/opnafm.c" "$src/libopna/opnassg.c" "$src/libopna/opnassg-sinc-c.c" \
  "$src/libopna/opnadrum.c" "$src/libopna/opnaadpcm.c" "$src/libopna/opnatimer.c" \
  -o "$out/pmd.js" \
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createPmdModule \
  -sENVIRONMENT=web,worker,node -sFILESYSTEM=0 \
  -sALLOW_MEMORY_GROWTH=0 -sINITIAL_MEMORY=4MB -sSTACK_SIZE=256KB \
  -sEXPORTED_RUNTIME_METHODS=HEAPU8,HEAPF32,UTF8ToString \
  -sINCOMING_MODULE_JS_API=wasmBinary,locateFile,instantiateWasm \
  -sDYNAMIC_EXECUTION=0 -sTEXTDECODER=2 \
  -Wno-unused-parameter
ls -l "$out"
