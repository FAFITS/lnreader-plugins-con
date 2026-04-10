import { load as loadCheerio } from 'cheerio';
import { fetchApi } from '@libs/fetch';
import { Plugin } from '@/types/plugin';
import { defaultCover } from '@libs/defaultCover';
import { FilterTypes, Filters, FilterToValues } from '@libs/filterInputs';
import { NovelStatus } from '@libs/novelStatus';
import { storage } from '@libs/storage';

class NocSyosetu implements Plugin.PagePlugin {
    id = 'noc.syosetu';
    name = 'NocSyosetu';
    icon = 'src/jp/nocsyosetu/icon.png';
    site = 'https://noc.syosetu.com/';
    version = '1.0.2';
    headers = {
        'Cookie': 'over18=yes',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://noc.syosetu.com/',
    };

    pluginSettings = {
        nocsyosetu_translate: {
            value: false,
            label: 'Translate Titles & Descriptions (Google Translate)',
            type: 'Switch',
        },
        nocsyosetu_translateLang: {
            value: 'en',
            label: 'Translate Language (e.g., en <default> , vi, th, ...)',
            type: 'Text',
        },
    };

    filters: Filters = {
        site: {
            label: 'サイト',
            type: FilterTypes.CheckboxGroup,
            value: ['all2'],
            options: [
                { label: 'ノクターンノベルズ', value: 'all2' },
                { label: 'ムーンライトノベルズ', value: 'all3' },
                { label: 'ミッドナイトノベルズ', value: 'all4' },
            ],
        },
        type: {
            label: 'タイプ',
            type: FilterTypes.Picker,
            value: '',
            options: [
                { label: 'すべて', value: '' },
                { label: '短編', value: 't' },
                { label: '連載', value: 'r' },
                { label: '完結済連載', value: 'er' },
            ],
        },
        novelend: {
            label: '完結状態',
            type: FilterTypes.Picker,
            value: '0',
            options: [
                { label: 'すべて', value: '0' },
                { label: '完結済のみ', value: '1' },
                { label: '連載中のみ', value: '2' },
            ],
        },
        order: {
            label: '並び替え',
            type: FilterTypes.Picker,
            value: 'new',
            options: [
                { label: '最新掲載順', value: 'new' },
                { label: '更新順', value: 'lastup' },
                { label: '古い順', value: 'old' },
                { label: '総合ポイント', value: 'hyoka' },
                { label: '日間ポイント', value: 'hyoka_d' },
                { label: '週間ポイント', value: 'hyoka_w' },
                { label: '月間ポイント', value: 'hyoka_m' },
                { label: '四半期ポイント', value: 'hyoka_q' },
                { label: '年間ポイント', value: 'hyoka_y' },
                { label: 'ブックマーク数', value: 'fav' },
                { label: '感想数', value: 'impression' },
                { label: '評価者数', value: 'review' },
                { label: '文字数', value: 'length' },
                { label: '読了時間', value: 'readingtime' },
            ],
        },
        exclude: {
            label: '除外',
            type: FilterTypes.CheckboxGroup,
            value: [],
            options: [
                { label: '残酷な描写', value: 'notzankoku' },
                { label: 'ボーイズラブ', value: 'notbl' },
                { label: 'ガールズラブ', value: 'notgl' },
                { label: '異世界転生', value: 'nottensei' },
                { label: '異世界転移', value: 'nottenyi' },
            ],
        },
    };

    private filtersTranslated = false;
    async translateFilters() {
        if (this.filtersTranslated || !storage.get('nocsyosetu_translate')) return;
        this.filtersTranslated = true;

        const translate = async (text: string) => {
            const cleanText = text.split(' (')[0];
            const translated = await this.translateService(cleanText);
            return translated ? `${cleanText} (${translated})` : text;
        };

        for (const key in this.filters) {
            const filter = (this.filters as any)[key];
            if (filter.label) filter.label = await translate(filter.label);
            if (filter.options) {
                for (const opt of filter.options) {
                    if (opt.label) opt.label = await translate(opt.label);
                }
            }
        }
    }

    async translateService(text: string): Promise<string> {
        if (!text) return text;
        const targetLang = storage.get('nocsyosetu_translateLang') || 'vi';
        try {
            const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=ja&tl=${targetLang}&dt=t&q=${encodeURIComponent(
                text,
            )}`;
            const res = await fetchApi(url);
            const json = await res.json();
            if (json && json[0]) {
                return json[0].map((item: any) => item[0]).join('');
            }
        } catch (e) {
            // ignore error
        }
        return text;
    }

    async translateToJapanese(text: string): Promise<string> {
        if (!text) return text;
        // Check if it's already Japanese (Hiragana, Katakana, or Kanji)
        const isJapanese = /[\u3040-\u309F]|[\u30A0-\u30FF]|[\u4E00-\u9FAF]/.test(text);
        if (isJapanese) return text;

        try {
            const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=ja&dt=t&q=${encodeURIComponent(
                text,
            )}`;
            const res = await fetchApi(url);
            const json = await res.json();
            if (json && json[0]) {
                return json[0].map((item: any) => item[0]).join('');
            }
        } catch (e) {
            // ignore error
        }
        return text;
    }

    async popularNovels(
        pageNo: number,
        options: Plugin.PopularNovelsOptions,
    ): Promise<Plugin.NovelItem[]> {
        await this.translateFilters();
        if (options.filters && Object.keys(options.filters).length > 0) {
            return this.searchNovels('', pageNo, options);
        }
        const url = `${this.site}pickup/list/?p=${pageNo}`;

        const result = await fetchApi(url, { headers: this.headers });
        const body = await result.text();

        const $ = loadCheerio(body);
        const novels: Plugin.NovelItem[] = [];

        $('.trackback_list').each((i, el) => {
            const $el = $(el);
            const titleAnchor = $el.find('.trackback_listdiv a').first();

            const name = titleAnchor.text().trim().replace(/\([^)]*\)$/, '').trim();
            let novelUrl = titleAnchor.attr('href');

            if (name && novelUrl) {
                if (!novelUrl.startsWith('http')) {
                    novelUrl = novelUrl.startsWith('/')
                        ? `https://novel18.syosetu.com${novelUrl}`
                        : `https://novel18.syosetu.com/${novelUrl}`;
                }

                novels.push({
                    name: name,
                    path: novelUrl,
                    cover: defaultCover,
                });
            }
        });

        if (storage.get('nocsyosetu_translate') && novels.length > 0) {
            await Promise.all(
                novels.map(async (n) => {
                    n.name = await this.translateService(n.name);
                })
            );
        }

        return novels;
    }

    parseChapters($page: any): Plugin.ChapterItem[] {
        const chapters: Plugin.ChapterItem[] = [];
        const chapterSelectors =
            '.novel_sublist2 .subtitle a, .p-eplist__sublist a.p-eplist__subtitle, .index_box .subtitle a';
        $page(chapterSelectors).each((i: number, el: any) => {
            const name = $page(el).text().trim();
            const path = $page(el).attr('href');
            if (name && path) {
                chapters.push({
                    name,
                    path: path.startsWith('http')
                        ? path
                        : path.startsWith('/')
                            ? `https://novel18.syosetu.com${path}`
                            : `https://novel18.syosetu.com/${path}`,
                    releaseTime: '',
                });
            }
        });
        return chapters;
    }

    async parseNovel(novelUrl: string): Promise<Plugin.SourceNovel & { totalPages: number }> {
        const result = await fetchApi(novelUrl, { headers: this.headers });
        const body = await result.text();

        const $ = loadCheerio(body);

        let lastPageNum = 1;
        const lastPageHref = $('.c-pager__item--last').attr('href');
        if (lastPageHref) {
            const match = lastPageHref.match(/\?p=(\d+)/);
            if (match && match[1]) {
                lastPageNum = parseInt(match[1]);
            }
        }

        let name = $('.p-novel__title').text().trim() || $('title').text().replace('ノクターンノベルズ', '').trim();
        let summary = $('#novel_ex, .p-novel__summary').text().trim();
        let genres = $('meta[name="keywords"]').attr('content') || '';

        if (storage.get('nocsyosetu_translate')) {
            name = await this.translateService(name);
            summary = await this.translateService(summary);
            if (genres) {
                genres = await this.translateService(genres);
            }
        }

        const novel: Plugin.SourceNovel & { totalPages: number } = {
            path: novelUrl,
            name,
            author: $('.p-novel__author').text().trim().replace('作者：', ''),
            summary,
            genres,
            cover: defaultCover,
            status: body.includes('完結済') ? NovelStatus.Completed : NovelStatus.Ongoing,
            chapters: this.parseChapters($),
            totalPages: lastPageNum,
        };

        return novel;
    }

    async parsePage(novelPath: string, page: string): Promise<Plugin.SourcePage> {
        const nextPageUrl = `${novelPath}${novelPath.endsWith('/') ? '' : '/'}?p=${page}`;
        const result = await fetchApi(nextPageUrl, { headers: this.headers });
        const body = await result.text();
        const $ = loadCheerio(body);

        return {
            chapters: this.parseChapters($),
        };
    }

    async parseChapter(chapterPath: string): Promise<string> {
        const result = await fetchApi(chapterPath, { headers: this.headers });
        const body = await result.text();

        const $ = loadCheerio(body);

        const content = $('.p-novel__body').html() || '';

        return content;
    }

    async searchNovels(
        searchTerm: string,
        pageNo: number,
        options?: { filters?: FilterToValues<Filters> },
    ): Promise<Plugin.NovelItem[]> {
        await this.translateFilters();
        const translatedSearchTerm = await this.translateToJapanese(searchTerm);
        let url = `${this.site}search/search/?word=${encodeURIComponent(
            translatedSearchTerm,
        )}&p=${pageNo}`;

        if (options?.filters) {
            const filters = options.filters;
            if (filters.site?.value) {
                (filters.site.value as string[]).forEach((v) => {
                    url += `&${v}=1`;
                });
            }
            if (filters.type?.value) {
                url += `&type=${filters.type.value}`;
            }
            if (filters.novelend?.value === '1') {
                url += `&novelend=1`;
            } else if (filters.novelend?.value === '2') {
                url += `&novelend_not=1`;
            }
            if (filters.order?.value) {
                url += `&order=${filters.order.value}`;
            }
            if (filters.exclude?.value) {
                (filters.exclude.value as string[]).forEach((v) => {
                    url += `&${v}=1`;
                });
            }
        }

        const result = await fetchApi(url, { headers: this.headers });
        const body = await result.text();

        const $ = loadCheerio(body);

        const novels: Plugin.NovelItem[] = [];

        $('.searchkekka_box').each((i, el) => {
            const $el = $(el);
            const titleAnchor = $el.find('.novel_h a').first();
            const name = titleAnchor.text().trim();
            const novelUrl = titleAnchor.attr('href');

            if (name && novelUrl) {
                novels.push({
                    name,
                    path: novelUrl.startsWith('http') ? novelUrl : `https://novel18.syosetu.com${novelUrl}`,
                    cover: defaultCover,
                });
            }
        });
        if (novels.length === 0) {
            $('.trackback_list').each((i, el) => {
                const firstDiv = $(el).find('.trackback_listdiv').first();
                const titleAnchor = firstDiv.find('a').first();
                const name = titleAnchor.text().trim();
                const novelUrl = titleAnchor.attr('href');

                if (name && novelUrl) {
                    novels.push({
                        name,
                        path: novelUrl.startsWith('http') ? novelUrl : `https://novel18.syosetu.com${novelUrl}`,
                        cover: defaultCover,
                    });
                }
            });
        }

        if (storage.get('nocsyosetu_translate') && novels.length > 0) {
            await Promise.all(
                novels.map(async (n) => {
                    n.name = await this.translateService(n.name);
                })
            );
        }

        return novels;
    }
}

export default new NocSyosetu();