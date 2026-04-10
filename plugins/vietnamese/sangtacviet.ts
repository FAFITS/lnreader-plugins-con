import { fetchApi, fetchText } from '@libs/fetch';
import { Plugin } from '@/types/plugin';
import { load as loadCheerio } from 'cheerio';
import { defaultCover } from '@libs/defaultCover';
import { NovelStatus } from '@libs/novelStatus';
import { Filters } from '@/types/filters';

class SangTacVietPlugin implements Plugin.PluginBase {
  id = 'sangtacviet';
  name = 'Sáng Tác Việt (Test)';
  icon = 'src/vi/hakolightnovel/icon.png';
  // site = 'https://sangtacviet.app';
  site = 'https://dns1.stv-appdomain-00000001.org';
  version = '1.0.0';

  filters?: Filters | undefined;

  async popularNovels(
    pageNo: number,
    { filters }: Plugin.PopularNovelsOptions<typeof this.filters>,
  ): Promise<Plugin.NovelItem[]> {
    const url = `${this.site}/io/searchtp/searchBooks?find=&minc=0&tag=&p=${pageNo}`;
    const html = await fetchText(url);
    const $ = loadCheerio(html);
    const books: Plugin.NovelItem[] = [];

    $('a.booksearch').each((index, element) => {
      const $book = $(element);
      const novelUrl = $book.attr('href');
      if (!novelUrl) {
        return;
      }
      const cover = $book.find('img').attr('src') || defaultCover;
      const title = $book.find('.searchbooktitle').text().trim();

      books.push({
        name: title,
        path: novelUrl,
        cover: cover,
      });
    });

    return books;
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    const url = novelPath.startsWith('http')
      ? novelPath
      : `${this.site}${novelPath}`;
    const urlObj = new URL(url);
    const pathSegments = urlObj.pathname.split('/').filter(Boolean);
    const service = pathSegments[1];
    const bookId = pathSegments[3];

    const html = await fetchText(url);
    const $ = loadCheerio(html);

    const thumbnail =
      $('meta[property="og:image"]').attr('content') ||
      $('#thumb-prop').attr('src') ||
      defaultCover;
    const title = $('#book_name2').text().trim();
    const author =
      $('meta[property="og:novel:author"]').attr('content') ||
      $('i.cap h2').text().trim();

    const genre = (
      $('meta[property="og:novel:category"]').attr('content')?.trim() || ''
    ).replace(/,/g, ', ');

    $('#book-sumary').find('br').replaceWith('\n');
    const summary = $('#book-sumary').text().trim();
    const statusText =
      $('meta[property="og:novel:status"]').attr('content') ||
      $('#bookstatus').text().trim();

    const status = statusText.toLowerCase().includes('đang')
      ? NovelStatus.Ongoing
      : NovelStatus.Completed;

    const chapters: Plugin.ChapterItem[] = [];

    const queryParams = new URLSearchParams();
    queryParams.append('ngmar', 'chapterlist');
    queryParams.append('h', service);
    queryParams.append('bookid', bookId);
    queryParams.append('sajax', 'getchapterlist');

    const chapterUrl = `${this.site}/index.php?${queryParams.toString()}`;
    const chapterRes = await fetchApi(chapterUrl, {
      headers: {
        'referer': this.site,
      },
    });

    const json = (await chapterRes.json()) as any;

    if (json.code === 1) {
      const chapterList = json.data.split('-//-');
      if (service === 'uukanshu') {
        chapterList.reverse();
      }

      let chapterNumber = 1;
      chapterList.forEach((chapter: string) => {
        const [what1, chapterId, chapTitle, check_vip] = chapter.split('-/-');
        const chapUrl = `/truyen/${service}/${what1}/${bookId}/${chapterId}/`;
        const isVip =
          check_vip &&
          check_vip !== 'unvip' &&
          check_vip !== 'unvip\n' &&
          !(json.unlocked && json.unlocked[chapterId]);

        chapters.push({
          name: `${(chapTitle || '').trim()} ${isVip ? '(VIP)' : ''}`.trim(),
          path: chapUrl,
          chapterNumber: chapterNumber++,
        });
      });
    }

    return {
      path: novelPath,
      name: title,
      cover: thumbnail,
      author: author,
      genres: genre,
      summary: summary,
      status: status,
      chapters: chapters,
    };
  }

  async parseChapter(chapterPath: string): Promise<string> {
    const url = chapterPath.startsWith('http')
      ? chapterPath
      : `${this.site}${chapterPath}`;
    const urlObj = new URL(url);
    const pathSegments = urlObj.pathname.split('/').filter(Boolean);
    const service = pathSegments[1];
    const bookId = pathSegments[3];
    const chapterId = pathSegments[4];

    const queryParams = new URLSearchParams();
    queryParams.append('ngmar', 'readc');
    queryParams.append('h', service);
    queryParams.append('bookid', bookId);
    queryParams.append('c', chapterId);
    queryParams.append('sajax', 'readchapter');
    queryParams.append('sty', '1');
    queryParams.append('exts', '');
    const apiUrl = `${this.site}/index.php?${queryParams.toString()}`;

    const res = await fetchApi(apiUrl, {
      method: 'POST',
      headers: {
        'accept': '*/*',
        'accept-language': 'vi,en-US;q=0.9,en;q=0.8',
        'content-type': 'application/x-www-form-urlencoded',
        'x-requested-with': 'XMLHttpRequest',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'referer': url,
      },
    });

    const json = (await res.json()) as any;
    let content = json.data;
    if (!content) {
        throw new Error('Failed to fetch chapter content. Thử lại với WebView.');
    }
    const bookhost = json.bookhost;

    if (!content) return '';
    if (content.includes('chat-')) return content;

    const decodeNumMask = (e: string) => {
      let t = '',
        n = e.split('-');
      for (let r = 0; r < n.length; r++)
        t += String.fromCharCode(parseInt(n[r], 10));
      return t;
    };

    if (bookhost === 'sangtac') {
      content = content
        .replace(/<[^i\/]/g, '&gt;')
        .replace(/[\n]+/g, '<br><br>')
        .replace(/ ([,\.!\?:”]+)/g, '$1')
        .replace(/\[\[([^[\]]*)\]\]/g, function (_: any, encoded: string) {
          let decoded = decodeNumMask(encoded);
          return '<img src="' + decoded + '">';
        });
      return content;
    }

    content = content.replace(/<\/p>\r\n<p>/g, '<br><br>');

    if (service === 'ciweimao' || bookhost === 'ciweimao') {
      content = content
        .replace(/<span>.*?<\/span>/g, '')
        .replace(
          /<img src="(.*?)".*?>/g,
          '<img referrerpolicy="no-referrer" src="$1">',
        );
    }

    if (bookhost === 'fanqie') {
      content = content.replace(/<\/?article>/g, '').replace(/_i_/g, '~');
    }

    content = content
      .replace(/đạo ?<\/i>:/g, 'nói</i>:')
      .replace(/&nbsp;&nbsp;&nbsp;&nbsp;/g, '<br>')
      .replace(/\n/g, '<br>')
      .replace(/(\w) \./g, '$1.')
      .replace(/((\w\.{1}[ \t])|(\w[!?]+(”|】)?))/g, '$1<br><br>')
      .replace(/<br( ?\/)?>/gi, '<br><br>')
      .replace(/(<br>(|\n|\t|\r| )*)+/g, '<br><br>')
      .replace(/([\w>])“/g, '$1 “')
      .replace(/(\w)<\/i><br>“/g, '$1</i>.<br>')
      .replace(/ ”/g, '”');

    if (service === 'uukanshu' || bookhost === 'uukanshu') {
      content = content.replace(/<div class="ad_content">.*?<\/div>/g, '');
    }
    if (service === 'aikanshu' || bookhost === 'aikanshu') {
      content = content.replace(/<img.*?src="\/novel\/images.*?>/g, '');
    }

    content = content
      .replace(/<a href=.*?<\/a>/g, '')
      .replace(/<br><br>([\)” 】!?]+)(<br>|$)/g, '$1$2')
      .replace(/ ([,’]) /g, '$1 ')
      .replace(/ ‘ /g, ' ‘')
      .replace('<a&nbsp;href="http:', '');

    if (bookhost === 'faloo') {
      content = content
        .replace(/<br>/g, '<br>\n')
        .replace(/<br>\n([^“][^\n“]*?)”<br>/g, '<br>“$1”<br>')
        .replace(/<br>\n/g, '<br>');
    }

    content = content
      .replace(/<\/p><br><br><p>/g, '<br><br>')
      .replace(/ ([,\.!\?”]+)/g, '$1');

    if (bookhost === 'fanqie') {
      content = content.replace(/src=".*?"/g, (m: string) =>
        m.replace(/<br>/g, ''),
      );
    }

    return content.replace('\ufffe', '');
  }

  async searchNovels(
    searchTerm: string,
    pageNo: number,
  ): Promise<Plugin.NovelItem[]> {
    const url = `${this.site}/io/searchtp/searchBooks?find=${encodeURIComponent(searchTerm)}&minc=0&tag=&p=${pageNo}`;
    const html = await fetchText(url);
    const $ = loadCheerio(html);
    const books: Plugin.NovelItem[] = [];

    $('a.booksearch').each((index, element) => {
      const $book = $(element);
      const novelUrl = $book.attr('href');
      if (!novelUrl) {
        return;
      }
      const cover = $book.find('img').attr('src') || defaultCover;
      const title = $book.find('.searchbooktitle').text().trim();

      books.push({
        name: title,
        path: novelUrl,
        cover: cover,
      });
    });

    return books;
  }
}

export default new SangTacVietPlugin();
