/**
 * KevinHtmlSanitizer.cjs
 *
 * High-Security Zero-Script Email HTML & Link Sandbox Sanitizer for KEVIN.
 * Strips malicious scripts, tracking pixels, forms, and isolates links into sandbox triggers.
 */

class KevinHtmlSanitizer {
    /**
     * Sanitizes raw HTML email body into a safe rendering sandbox.
     * @param {string} rawHtml - Unsanitized HTML or plaintext
     * @param {object} options - Configuration options
     * @returns {object} { sanitizedHtml, extractedLinks, trackingPixelsBlocked, scriptTagsRemoved }
     */
    static sanitize(rawHtml = '', options = {}) {
        if (typeof rawHtml !== 'string') rawHtml = String(rawHtml || '');

        let trackingPixelsBlocked = 0;
        let scriptTagsRemoved = 0;
        const extractedLinks = [];

        let clean = rawHtml;

        // 1. Remove dangerous script tags and content
        clean = clean.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, () => {
            scriptTagsRemoved++;
            return '<!-- [KEVIN SANITIZED: Dangerous <script> block removed] -->';
        });

        // 2. Remove dangerous structural tags (iframe, object, embed, applet, form, base)
        const dangerousTagsRegex = /<\/?(iframe|object|embed|applet|form|base|input|button|textarea|select|option)\b[^>]*>/gi;
        clean = clean.replace(dangerousTagsRegex, (match, tag) => {
            return `<!-- [KEVIN SANITIZED: Blocked <${tag}> tag] -->`;
        });

        // 3. Strip inline event handlers (onload, onerror, onclick, onmouseover, etc.)
        clean = clean.replace(/(\s+)on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, (match, space) => {
            scriptTagsRemoved++;
            return `${space}data-sanitized-event="blocked"`;
        });

        // 4. Neutralize javascript: and data: URIs in src, href, and action attributes
        clean = clean.replace(/(href|src|action)\s*=\s*(?:"(javascript|data):[^"]*"|'(javascript|data):[^']*'|(javascript|data):[^\s>]+)/gi, (match, attr) => {
            return `${attr}="about:blank" data-sanitized-protocol="blocked"`;
        });

        // 5. Detect & strip 1x1 tracking pixels (common web beacons)
        const trackingPixelRegex = /<img\b[^>]*?(?:width\s*=\s*["']?[01]["']?|height\s*=\s*["']?[01]["']?|style\s*=\s*["']?[^"']*(?:width|height)\s*:\s*[01]px[^"']*["']?)[^>]*>/gi;
        clean = clean.replace(trackingPixelRegex, () => {
            trackingPixelsBlocked++;
            return '<!-- [KEVIN SANITIZED: Web beacon tracking pixel blocked] -->';
        });

        // 6. Sandbox all external anchor links (<a href="...">)
        const anchorRegex = /<a\b([^>]*)href=["']([^"']+)["']([^>]*)>(.*?)<\/a>/gi;
        clean = clean.replace(anchorRegex, (match, preAttrs, href, postAttrs, linkText) => {
            if (href.startsWith('http://') || href.startsWith('https://')) {
                extractedLinks.push({ href, text: linkText.replace(/<[^>]+>/g, '').trim() });
                const encodedUrl = encodeURIComponent(href);
                return `<a ${preAttrs} href="javascript:void(0)" data-kevin-sandbox-url="${href}" class="kevin-sandboxed-link" style="color: #3b82f6; text-decoration: underline; cursor: pointer;" title="KEVIN Sandboxed Link: ${href}">${linkText} <span style="font-size: 10px; background: #1e293b; color: #38bdf8; padding: 2px 5px; border-radius: 3px; margin-left: 4px;">🔍 SAFE PREVIEW</span></a>`;
            }
            return match;
        });

        return {
            success: true,
            sanitizedHtml: clean,
            extractedLinks,
            stats: {
                trackingPixelsBlocked,
                scriptTagsRemoved,
                totalExtractedLinks: extractedLinks.length
            }
        };
    }
}

module.exports = { KevinHtmlSanitizer };
