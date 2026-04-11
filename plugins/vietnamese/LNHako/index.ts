import { fetchApi } from '@libs/fetch';
import { load } from 'cheerio';
import { Plugin } from '@/types/plugin';
import { NovelStatus } from '@libs/novelStatus';
import { FilterTypes, Filters } from '@libs/filterInputs';
import { storage } from '@libs/storage';
import {
  parseDmyToIso,
  parseProtectedChunks,
  decodeProtectedContent,
} from './utils';

class HakoPlugin implements Plugin.PluginBase {
  id = 'ln.hako.vn';
  name = 'Hako Novel';
  icon = 'src/vi/hakolightnovel/icon.png';
  version = '1.1.21';

  pluginSettings = {
    usingDocln: {
      value: '',
      label: 'Sử dụng tên miền docln.sbs (nếu ln.hako.vn bị lỗi)',
      type: 'Switch',
    },
    showAllChapters: {
      value: '',
      label:
        'Hiển thị tất cả chương, không chia theo Volume. Tương thích với LNReader gốc.',
      type: 'Switch',
    },
  };

  get site() {
    return this.usingDocln ? 'https://docln.sbs' : 'https://ln.hako.vn';
  }

  get usingDocln() {
    return storage.get('usingDocln') as boolean;
  }

  get showAllChapters() {
    return storage.get('showAllChapters') as boolean;
  }

  private async fetchHtmlFromMirrors(
    path: string,
    validator?: (html: string) => boolean,
  ): Promise<string> {
    const res = await fetchApi(this.site + path);
    console.log(`Fetched ${this.site + path} - Status: ${res.status}`);
    const html = res.ok ? await res.text() : '';
    // Idk why hako returns 403 but fetchjs return 200???
    const $ = load(html);
    // Check class: error-page, error-name, error-note
    const errorPage = $('.error-page');
    const errorName = errorPage.find('.error-name')?.first()?.text()?.trim();
    const errorNote = errorPage.find('.error-note')?.first().text()?.trim();
    if (errorPage?.length || errorName?.length || errorNote?.length) {
      throw new Error(`Hako error: ${errorName} - ${errorNote}`);
    }
    if (html && (!validator || validator(html))) {
      return html;
    } else {
      throw new Error('Failed to fetch valid HTML from ' + this.site);
    }
  }

  async parseNovels(url: string) {
    const html = await fetchApi(url).then(res => res.text());
    const $ = load(html);
    const novels: Plugin.NovelItem[] = [];

    $('.thumb-item-flow').each((_, ele) => {
      const name = $(ele).find('.series-title a').attr('title') || '';
      const path = $(ele).find('.series-title a').attr('href') || '';
      const cover = $(ele).find('.img-in-ratio').attr('data-bg') || '';

      if (name && path) {
        novels.push({ name, path, cover });
      }
    });

    return novels;
  }
  async popularNovels(
    pageNo: number,
    { filters }: Plugin.PopularNovelsOptions<typeof this.filters>,
  ): Promise<Plugin.NovelItem[]> {
    let link = this.site + '/danh-sach';
    if (filters) {
      if (filters.alphabet.value) {
        link += '/' + filters.alphabet.value;
      }
      const params = new URLSearchParams();
      for (const novelType of filters.type.value) {
        params.append(novelType, '1');
      }
      for (const status of filters.status.value) {
        params.append(status, '1');
      }
      params.append('sapxep', filters.sort.value);
      link += '?' + params.toString() + '&page=' + pageNo;
    } else {
      link += '?page=' + pageNo;
    }
    return this.parseNovels(link);
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    const novel: Plugin.SourceNovel = {
      path: novelPath,
      name: '',
      author: '',
      artist: '',
      summary: '',
      genres: '',
      status: '',
    };
    const html = await this.fetchHtmlFromMirrors(
      novelPath,
      html => load(html)('.volume-list .list-chapters li').length > 0,
    );

    const $ = load(html);

    novel.name = $('.series-name').first().text().trim();
    novel.summary = $('.summary-content p')
      .map(function () {
        return $(this).text().trim();
      })
      .get()
      .join('\n');

    const coverEl = $('.series-cover .img-in-ratio').first();
    const coverDataBg = coverEl.attr('data-bg')?.trim();
    if (coverDataBg) {
      novel.cover = coverDataBg;
    } else {
      const style = coverEl.attr('style') || '';
      const matchedCover = style.match(/url\(['"]?(.*?)['"]?\)/i);
      if (matchedCover?.[1]) {
        novel.cover = matchedCover[1];
      }
    }

    novel.genres = $('.series-gernes .series-gerne-item')
      .map((_, element) => $(element).text().trim())
      .get()
      .filter(Boolean)
      .join(',');

    const infoItems = $('.series-information .info-item');
    novel.author = '';
    novel.artist = '';
    novel.status = '';

    infoItems.each((_, element) => {
      const item = $(element);
      const label = item.find('.info-name').first().text().toLowerCase().trim();
      const value = item
        .find('.info-value')
        .first()
        .text()
        .replace(/\s+/g, ' ')
        .trim();

      if (!value) {
        return;
      }

      if (!novel.author && label.includes('tác giả')) {
        novel.author = value;
        return;
      }

      if (
        !novel.artist &&
        (label.includes('họa sĩ') ||
          label.includes('hoạ sĩ') ||
          label.includes('artist'))
      ) {
        novel.artist = value;
        return;
      }

      if (!novel.status && label.includes('tình trạng')) {
        novel.status = value;
      }
    });

    const parsedChapters: Plugin.ChapterItem[] = [];
    let num = 0;
    let part = 1;

    $('.volume-list').each((_, volumeElement) => {
      const volume = $(volumeElement)
        .find('.sect-title')
        .first()
        .text()
        .replace(/\*/g, '') // ?
        .replace(/\s+/g, ' ')
        .trim();

      $(volumeElement)
        .find('.list-chapters > li')
        .each((__, chapterElement) => {
          const chapterNode = $(chapterElement).find('.chapter-name a').first();
          const path = chapterNode.attr('href') || '';
          const name =
            chapterNode.attr('title')?.trim() ||
            chapterNode.text().replace(/\s+/g, ' ').trim();

          if (!path || !name) {
            return;
          }

          const matchedChapterNumber = name.match(
            /(?:chương|chapter)\s*(\d+(?:\.\d+)?)/i,
          );

          let chapterNumber = num + part / 10;
          if (matchedChapterNumber) {
            const parsedNumber = Number(matchedChapterNumber[1]);
            if (!Number.isNaN(parsedNumber) && parsedNumber > 0) {
              if (num === parsedNumber) {
                chapterNumber = num + part / 10;
                part += 1;
              } else {
                num = parsedNumber;
                part = 1;
                chapterNumber = parsedNumber;
              }
            }
          } else {
            part += 1;
          }

          const chapter: Plugin.ChapterItem = {
            path,
            name,
            page: volume,
            chapterNumber,
          };

          if (this.showAllChapters) {
            delete chapter.page;
            chapter.name = `[${volume}]: ${chapter.name}`;
          }

          const releaseTimeRaw = $(chapterElement)
            .find('.chapter-time')
            .first()
            .text();
          const releaseTime = parseDmyToIso(releaseTimeRaw);
          if (releaseTime) {
            chapter.releaseTime = releaseTime;
          }

          parsedChapters.push(chapter);
        });
    });

    novel.chapters = parsedChapters;
    switch (novel.status?.trim()) {
      case 'Đang tiến hành':
      case 'đang tiến hành':
        novel.status = NovelStatus.Ongoing;
        break;
      case 'Tạm ngưng':
      case 'tạm ngưng':
        novel.status = NovelStatus.OnHiatus;
        break;
      case 'Đã hoàn thành':
      case 'Hoàn thành':
      case 'đã hoàn thành':
      case 'hoàn thành':
      case 'Completed':
        novel.status = NovelStatus.Completed;
        break;
      default:
        novel.status = NovelStatus.Unknown;
    }
    novel.genres = novel.genres?.replace(/,*\s*$/, '');
    novel.name = novel.name.trim();
    novel.summary = novel.summary?.trim();

    console.log(novel);
    return novel;
  }
  async parsePage(novelPath: string, page: string): Promise<Plugin.SourcePage> {
    const novel = await this.parseNovel(novelPath);
    return {
      chapters: novel.chapters || [],
    };
  }
  async parseChapter(chapterPath: string): Promise<string> {
    const html = await this.fetchHtmlFromMirrors(
      chapterPath,
      html => load(html)('div#chapter-content').length > 0,
    );

    const $ = load(html);
    const chapterContainer = $('div#chapter-content').first();

    if (!chapterContainer.length) {
      return 'Không tìm thấy nội dung';
    }

    const protectedContent = chapterContainer
      .find('#chapter-c-protected')
      .first();

    if (protectedContent.length) {
      const mode = protectedContent.attr('data-s') || '';
      const key = protectedContent.attr('data-k') || '';
      const chunks = parseProtectedChunks(
        protectedContent.attr('data-c') || '',
      );
      const decodedContent = decodeProtectedContent(mode, key, chunks);

      if (decodedContent.trim()) {
        protectedContent.replaceWith(decodedContent);
      } else {
        protectedContent.remove();
      }
    }

    chapterContainer
      .find(
        'p.none,script,style,iframe,[style*="display: none"],[style*="display:none"]',
      )
      .remove();

    const chapterText = (chapterContainer.html() || '')
      .replace(/<p id="\d+">/g, '<p>')
      .replace(/\[note\d+]/gi, '')
      .replace(/&nbsp;/g, '');

    return chapterText || 'Không tìm thấy nội dung';
  }

  async searchNovels(
    searchTerm: string,
    pageNo: number,
  ): Promise<Plugin.NovelItem[]> {
    const url =
      this.site + '/tim-kiem?keywords=' + searchTerm + '&page=' + pageNo;
    return this.parseNovels(url);
  }
  imageRequestInit: Plugin.ImageRequestInit = {
    headers: {
      Referer: this.site,
    },
  };
  filters = {
    alphabet: {
      type: FilterTypes.Picker,
      value: '',
      label: 'Chữ cái',
      options: [
        { label: 'Tất cả', value: '' },
        { label: 'Khác', value: 'khac' },
        { label: 'A', value: 'a' },
        { label: 'B', value: 'b' },
        { label: 'C', value: 'c' },
        { label: 'D', value: 'd' },
        { label: 'E', value: 'e' },
        { label: 'F', value: 'f' },
        { label: 'G', value: 'g' },
        { label: 'H', value: 'h' },
        { label: 'I', value: 'i' },
        { label: 'J', value: 'j' },
        { label: 'K', value: 'k' },
        { label: 'L', value: 'l' },
        { label: 'M', value: 'm' },
        { label: 'N', value: 'n' },
        { label: 'O', value: 'o' },
        { label: 'P', value: 'p' },
        { label: 'Q', value: 'q' },
        { label: 'R', value: 'r' },
        { label: 'S', value: 's' },
        { label: 'T', value: 't' },
        { label: 'U', value: 'u' },
        { label: 'V', value: 'v' },
        { label: 'W', value: 'w' },
        { label: 'X', value: 'x' },
        { label: 'Y', value: 'y' },
        { label: 'Z', value: 'z' },
      ],
    },
    type: {
      type: FilterTypes.CheckboxGroup,
      label: 'Phân loại',
      value: [],
      options: [
        { label: 'Truyện dịch', value: 'truyendich' },
        { label: 'Truyện sáng tác', value: 'sangtac' },
        { label: 'Truyện AI dịch (Convert)', value: 'convert' },
      ],
    },
    status: {
      type: FilterTypes.CheckboxGroup,
      label: 'Tình trạng',
      value: [],
      options: [
        { label: 'Đang tiến hành', value: 'dangtienhanh' },
        { label: 'Tạm ngưng', value: 'tamngung' },
        { label: 'Đã hoàn thành', value: 'hoanthanh' },
      ],
    },
    sort: {
      type: FilterTypes.Picker,
      label: 'Sắp xếp',
      value: 'top',
      options: [
        { label: 'A-Z', value: 'tentruyen' },
        { label: 'Z-A', value: 'tentruyenza' },
        { label: 'Mới cập nhật', value: 'capnhat' },
        { label: 'Truyện mới', value: 'truyenmoi' },
        { label: 'Theo dõi', value: 'theodoi' },
        { label: 'Top toàn thời gian', value: 'top' },
        { label: 'Top tháng', value: 'topthang' },
        { label: 'Số từ', value: 'sotu' },
      ],
    },
  } satisfies Filters;
}

export default new HakoPlugin();
