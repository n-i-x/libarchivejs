#define LIBARCHIVE_STATIC
// #include "emscripten.h"
#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <locale.h>
#include <archive.h>
#include <archive_entry.h>
#define EMSCRIPTEN_KEEPALIVE

EMSCRIPTEN_KEEPALIVE
const char *get_version(){
  return archive_version_string();
}

EMSCRIPTEN_KEEPALIVE
void *archive_open(const void *buf, size_t size, const char *passphrase, const char *locale){
  struct archive *a;
  int r;

  setlocale(LC_ALL, locale);

  a = archive_read_new();
  archive_read_support_filter_all(a);
  archive_read_support_format_all(a);

  if (passphrase)
  {
    archive_read_add_passphrase(a, passphrase);
  }

  r = archive_read_open_memory(a, buf, size);
  if (r != ARCHIVE_OK)
  {
    fprintf(stderr, "Memory read error %d\n", r);
    fprintf(stderr, "%s\n", archive_error_string(a));
  }
  return a;
}

// Block size used when reading an archive from the emscripten filesystem. Large
// enough that a multi-gigabyte archive isn't read a page at a time, small enough
// that it costs nothing for a small one.
#define LA_FILE_BLOCK_SIZE (1024 * 1024)

EMSCRIPTEN_KEEPALIVE
void *archive_open_file(const char *path, const char *passphrase, const char *locale){
  struct archive *a;
  int r;

  setlocale(LC_ALL, locale);

  a = archive_read_new();
  archive_read_support_filter_all(a);
  archive_read_support_format_all(a);

  if (passphrase)
  {
    archive_read_add_passphrase(a, passphrase);
  }

  // Unlike archive_read_open_memory, this gives libarchive a seekable stream, so
  // formats whose directory lives at the end of the file (7z, zip) can be read
  // without the whole archive being resident in wasm memory.
  r = archive_read_open_filename(a, path, LA_FILE_BLOCK_SIZE);
  if (r != ARCHIVE_OK)
  {
    fprintf(stderr, "File read error %d\n", r);
    fprintf(stderr, "%s\n", archive_error_string(a));
  }
  return a;
}

// archive_entry_size returns la_int64_t, which cwrap's "number" truncates to 32
// bits on wasm32 — a 3GB entry reads back as garbage. A double carries every
// integer up to 2^53 exactly, so the size survives the boundary intact.
EMSCRIPTEN_KEEPALIVE
double get_entry_size(void *entry){
  return (double)archive_entry_size((struct archive_entry *)entry);
}

EMSCRIPTEN_KEEPALIVE
const void *get_next_entry(void *archive){
  struct archive_entry *entry;
  if (archive_read_next_header(archive, &entry) == ARCHIVE_OK)
  {
    return entry;
  }
  else
  {
    return NULL;
  }
}

EMSCRIPTEN_KEEPALIVE
void *get_filedata(void *archive, size_t buffsize){
  void *buff = malloc(buffsize);
  if (buff == NULL)
  {
    fprintf(stderr, "Failed to allocate %zu bytes for entry data\n", buffsize);
    return NULL;
  }
  int read_size = archive_read_data(archive, buff, buffsize);
  if (read_size < 0)
  {
    fprintf(stderr, "Error occured while reading file");
    // Pointers are unsigned on the JS side, so a negative return can't be
    // detected there; report the failure as NULL and don't leak the buffer.
    free(buff);
    return NULL;
  }
  else
  {
    return buff;
  }
}

EMSCRIPTEN_KEEPALIVE
void archive_close(void *archive){
  int r = archive_read_free(archive);
  if (r != ARCHIVE_OK)
  {
    fprintf(stderr, "Error read free %d\n", r);
    fprintf(stderr, "%s\n", archive_error_string(archive));
  }
}

EMSCRIPTEN_KEEPALIVE
void *start_archive_write(char *filter, char *format, void *buff, size_t buffsize, size_t *outputsize, char *passphrase){
  struct archive *a;
  a = archive_write_new();
  archive_write_add_filter_by_name(a, filter);
  archive_write_set_format_by_name(a, format);

  if(passphrase){
    archive_write_set_passphrase(a, passphrase);
  }

  archive_write_open_memory(a, buff, buffsize, outputsize);
  return a;
}

EMSCRIPTEN_KEEPALIVE
void write_archive_file( void *a, char *pathname, size_t filesize , void *filedata ){
  struct archive_entry *entry;

  entry = archive_entry_new();
  archive_entry_set_pathname(entry, pathname);
  archive_entry_set_size(entry, filesize);
  archive_entry_set_filetype(entry, AE_IFREG);
  archive_entry_set_perm(entry, 0644);
  archive_write_header(a, entry);
  int write_output = archive_write_data(a, filedata, filesize);
  if( write_output != filesize ) {
    fprintf(stderr, "Error occured while writing file, written bytes don't match file size\n");
  }

  archive_entry_free(entry);
}

EMSCRIPTEN_KEEPALIVE
int size_of_size_t(){
  return sizeof(size_t);
}

EMSCRIPTEN_KEEPALIVE
int finish_archive_write(void *a, size_t *outputsize){
  if( archive_write_close(a) != ARCHIVE_OK ){
    return -1;
  }
  
  if( archive_write_free(a) != ARCHIVE_OK ){
    return -1;
  }
  return *outputsize;
}