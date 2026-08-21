emcc ../wrapper/main.c -c -I /usr/local/include/ -o ../build/main.o

# WORKERFS + FORCE_FILESYSTEM let the worker mount the input File and let
# libarchive read it lazily through Blob slices (archive_open_file), instead of
# copying the whole archive into the wasm heap. MAXIMUM_MEMORY is raised because
# wasm32 defaults to a 2GB cap; the heap now holds only codec state and buffers,
# but a large LZMA dictionary can still need room.
emcc ../build/main.o /usr/local/lib/libarchive.a /usr/local/lib/liblzma.a /usr/local/lib/libssl.a /usr/local/lib/libcrypto.a \
    -o ../build/libarchive.js \
    -s USE_ZLIB=1 -s USE_BZIP2=1 -s MODULARIZE=1 -s EXPORT_ES6=1 -s EXPORT_NAME=libarchive -s WASM=1 -O3 \
    -s ALLOW_MEMORY_GROWTH=1 -s MAXIMUM_MEMORY=4GB \
    -s FORCE_FILESYSTEM=1 -lworkerfs.js \
    -s EXPORTED_RUNTIME_METHODS='["cwrap","stringToNewUTF8","FS","WORKERFS"]' \
    -s EXPORTED_FUNCTIONS=@$PWD/lib.exports -s ERROR_ON_UNDEFINED_SYMBOLS=0

cp ../build/libarchive.js ../../src/webworker/wasm-gen/
cp ../build/libarchive.wasm ../../src/webworker/wasm-gen/

echo Done
