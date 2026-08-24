# Pinned so a rebuild produces the same wasm. Upstream tracked `latest`, which
# silently changes the toolchain (and with it the emitted glue) between builds.
# Override with: docker build --build-arg EMSDK_VERSION=x.y.z
# Note: the vendored openssl 1.0.2s is from 2019 and is the component most
# likely to break against a much newer toolchain — bump this deliberately.
ARG EMSDK_VERSION=3.1.74
FROM emscripten/emsdk:${EMSDK_VERSION}

WORKDIR /opt

ADD https://github.com/madler/zlib/releases/download/v1.3/zlib13.zip /opt
ADD https://github.com/tukaani-project/xz/releases/download/v5.2.11/xz-5.2.11.tar.gz /opt
ADD https://sourceware.org/pub/bzip2/bzip2-1.0.8.tar.gz /opt
ADD https://www.openssl.org/source/openssl-1.0.2s.tar.gz /opt

RUN unzip /opt/zlib13.zip && rm /opt/zlib13.zip && \
    tar xf /opt/xz-5.2.11.tar.gz && rm /opt/xz-5.2.11.tar.gz && \
    tar xf /opt/bzip2-1.0.8.tar.gz && rm /opt/bzip2-1.0.8.tar.gz && \
    tar xf /opt/openssl-1.0.2s.tar.gz && rm /opt/openssl-1.0.2s.tar.gz

RUN apt-get update && \
    apt-get install -y locate vim file

ENV CPPFLAGS "-I/usr/local/include/ -I/opt/zlib-1.3 -I/opt/bzip2-1.0.8 -I/opt/openssl-1.0.2s/include -I/opt/openssl-1.0.2s/test"
ENV LDLIBS "-lz -lssl -lcrypto -lbz2"
ENV LDFLAGS "-L/usr/local/lib"

# Compile zlib to LLVM
WORKDIR /opt/zlib-1.3
RUN cd /opt/zlib-1.3 && emconfigure ./configure --static && emmake make && emmake make install

# Compile bzip2 to LLVM
WORKDIR /opt/bzip2-1.0.8
RUN cd /opt/bzip2-1.0.8 && emmake make && emmake make install

# Compile openSSL to LLVM
WORKDIR /opt/openssl-1.0.2s
RUN cd /opt/openssl-1.0.2s && emconfigure /usr/bin/perl ./Configure -no-asm -no-apps no-ssl2 no-ssl3 no-hw no-deprecated shared no-dso linux-generic32 && \
    sed -i 's/CC= $(CROSS_COMPILE)\/emsdk\/upstream\/emscripten\/emcc/CC= $(CROSS_COMPILE)cc/' Makefile && \
    sed -i 's/-Bsymbolic/ /' Makefile.shared && \
    emmake make && \
    cd /usr/local/lib && \
    ln -s /opt/openssl-1.0.2s/libssl.a && \
    ln -s /opt/openssl-1.0.2s/libcrypto.a

# Compile LZMA to LLVM
WORKDIR /opt/xz-5.2.11
RUN cd /opt/xz-5.2.11 && emconfigure ./configure --disable-assembler --enable-threads=no --enable-static=yes 2>&1 | tee conf.out && \
    emmake make 2>&1 | tee make.out && emmake make install

# libarchive is fetched and built last, on its own layers, so bumping it doesn't
# invalidate the codec builds above — those take the bulk of the build time and
# never change. Override with: docker build --build-arg LIBARCHIVE_VERSION=x.y.z
# 3.8.9 is what the committed wasm is built from (the 3.7.2 default predated that
# bump), and what patches/ is written against — a mismatch fails at `patch`.
ARG LIBARCHIVE_VERSION=3.8.9
ADD https://github.com/libarchive/libarchive/releases/download/v${LIBARCHIVE_VERSION}/libarchive-${LIBARCHIVE_VERSION}.zip /opt
# -d matters: the working directory here is still the previous build's source
# tree, and unzip would otherwise extract into it.
RUN unzip -q /opt/libarchive-${LIBARCHIVE_VERSION}.zip -d /opt && rm /opt/libarchive-${LIBARCHIVE_VERSION}.zip

# Local patches to libarchive, applied before the build. Upstream libarchive has
# no RAR decryption -- it detects encrypted entries and refuses them -- so this
# project carries that support here. Keep each patch focused and
# rebased when LIBARCHIVE_VERSION moves; a patch that no longer applies fails the
# build loudly rather than silently producing a wasm without the feature.
#
# The patches live under the docker build context because COPY cannot reach
# outside it. Build the image from this directory:
#   docker build -t libarchive-llvm lib/tools/docker/
COPY patches/ /opt/patches/
RUN cd /opt/libarchive-${LIBARCHIVE_VERSION} && \
    for p in /opt/patches/*.patch; do \
      echo "applying $(basename "$p")" && patch -p1 --batch --forward < "$p" || exit 1; \
    done

# Compile libarchive to LLVM
ENV EMCC_CFLAGS "-s USE_BZIP2=1"
WORKDIR /opt/libarchive-${LIBARCHIVE_VERSION}
RUN emconfigure ./configure --enable-static --disable-shared --enable-bsdtar=static --enable-bsdcat=static \
    --enable-bsdcpio=static --enable-posix-regex-lib=libc \
    --disable-xattr --disable-acl --without-nettle --without-lzo2 \
    --without-cng  --without-lz4 \
    --without-xml2 --without-expat 2>&1 | tee conf.out && \
    emmake make 2>&1 | tee make.out && emmake make install
ENV EMCC_CFLAGS ""

#--without-openssl
#--without-bz2lib --without-iconv --without-libiconv-prefix --without-lzma 

WORKDIR /var/local/lib/tools
CMD ["bash","/var/local/lib/tools/build.sh"]
