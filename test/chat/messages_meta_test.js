/**
 * @fileOverview
 * Validation of received management and CONTAINS_META messages.
 */

describe("chat.messages meta unit test", function() {
    "use strict";

    var assert = chai.assert;
    var {RICH_PREVIEW, GEOLOCATION, GIPHY} = Message.MESSAGE_META_TYPE;
    const {MANAGEMENT, ATTACHMENT, VOICE_CLIP, CONTACT, CONTAINS_META, REVOKE_ATTACHMENT} =
        Message.MANAGEMENT_MESSAGE_TYPES;

    var sanitize = function(metaType, meta, textContents = 'hello') {
        var msg = {metaType, meta, textContents, messageHtml: 'hello'};
        Message.sanitize(msg);
        return msg;
    };
    var preview = (...extra) => sanitize(RICH_PREVIEW, {extra}).metaType;
    var entry = {t: 'Title', d: 'Description', i: 'png:AAAA', ic: 'png:BBBB', url: 'https://mega.io/'};
    const body = (textContents) => sanitize(undefined, undefined, textContents).textContents;
    const node = {h: 'BBBBBBBB', k: [1, 2, 3, 4, 5, 6, 7, 8], t: 0, s: 1, fa: '1:0*CCCC', ts: 1, hash: 'x', name: 'a.txt'};
    const contact = {u: 'AAAAAAAAAAA', email: 'someone@example.com', name: 'Someone'};
    const gif = {src: 'giphy://a.mp4', src_webp: 'giphy://a.webp', s: '1', s_webp: '2', w: '200', h: '100'};

    // Don't log the malformed bodies under test
    const {_safeParseJSON} = Message.prototype;

    beforeEach(function() {
        Message.prototype._safeParseJSON = tryCatch(JSON.parse.bind(JSON), false);
    });

    afterEach(function() {
        Message.prototype._safeParseJSON = _safeParseJSON;
    });

    it("keeps legitimate management bodies", function() {
        [
            MANAGEMENT + ATTACHMENT + JSON.stringify([node]),
            MANAGEMENT + ATTACHMENT + JSON.stringify([node, {...node, h: 'DDDDDDDD'}]),
            MANAGEMENT + VOICE_CLIP + JSON.stringify([{...node, playtime: 3}]),
            MANAGEMENT + CONTACT + JSON.stringify([contact]),
            MANAGEMENT + CONTACT + JSON.stringify([contact, {u: 'EEEEEEEEEEE', m: 'other@example.com'}]),
            MANAGEMENT + CONTAINS_META + RICH_PREVIEW + JSON.stringify({textMessage: 'hi', extra: [entry]}),
            MANAGEMENT + REVOKE_ATTACHMENT + 'BBBBBBBB',
            MANAGEMENT,
            'plain text'
        ].forEach((textContents, i) => {
            assert.strictEqual(body(textContents), textContents, `body #${i}`);
        });
    });

    it("blanks malformed management bodies", function() {
        const nodeLists = ['', 'junk', 'null', '{}', '"x"', '[null]', '[1]', '["x"]', '{"0":{}}'];
        const contacts = [
            ...nodeLists,
            '[{}]',
            '[{"u":1}]',
            JSON.stringify([{...contact, email: {}}]),
            JSON.stringify([{...contact, m: []}]),
            JSON.stringify([{...contact, name: {}}]),
            JSON.stringify([contact, null])
        ];

        nodeLists.forEach((json, i) => {
            assert.strictEqual(body(MANAGEMENT + ATTACHMENT + json), '', `attachment #${i}`);
            assert.strictEqual(body(MANAGEMENT + VOICE_CLIP + json), '', `voice clip #${i}`);
        });
        contacts.forEach((json, i) => {
            assert.strictEqual(body(MANAGEMENT + CONTACT + json), '', `contact #${i}`);
        });
        ['', 'junk', 'null', '1', '"x"'].forEach((json, i) => {
            assert.strictEqual(body(MANAGEMENT + CONTAINS_META + RICH_PREVIEW + json), '', `meta #${i}`);
        });

        const msg = sanitize(undefined, undefined, MANAGEMENT + CONTACT + 'junk');
        assert.strictEqual(msg.messageHtml, '');
    });

    it("checks the unwrapped textMessage", function() {
        [
            MANAGEMENT + CONTACT + 'junk',
            MANAGEMENT + ATTACHMENT + 'null',
            MANAGEMENT + CONTAINS_META + RICH_PREVIEW + 'x'
        ].forEach((textMessage, i) => {
            assert.strictEqual(sanitize(GIPHY, gif, textMessage).textContents, '', `textMessage #${i}`);
        });
    });

    it("keeps legitimate rich previews", function() {
        assert.strictEqual(preview(entry), RICH_PREVIEW);
        assert.strictEqual(preview(entry, {...entry, url: 'http://example.com/a?b=c'}), RICH_PREVIEW);
        assert.strictEqual(preview({url: 'https://example.com'}), RICH_PREVIEW, 'loading entry');
        assert.strictEqual(preview({...entry, t: null, d: null, i: null, ic: null}), RICH_PREVIEW);
        assert.strictEqual(preview({...entry, url: 'HTTPS://EXAMPLE.COM'}), RICH_PREVIEW);
        assert.strictEqual(preview(), RICH_PREVIEW, 'no entries');
        assert.strictEqual(sanitize(RICH_PREVIEW, {extra: [entry], requiresConfirmation: true}).metaType, RICH_PREVIEW);
    });

    it("renders malformed rich previews as plain text", function() {
        var bad = [
            {t: 'no url'},
            {...entry, url: ['https://mega.io/']},
            {...entry, url: 42},
            {...entry, url: 'mailto:someone@example.com'},
            {...entry, url: 'ftp://example.com/'},
            {...entry, url: ' https://mega.io/'},
            {...entry, url: '//mega.io/'},
            {...entry, t: {}},
            {...entry, d: ['a']},
            {...entry, i: {split: 1}},
            {...entry, ic: {}},
            null,
            'https://mega.io/'
        ];
        bad.forEach((e, i) => {
            assert.strictEqual(preview(e), -1, `entry #${i}`);
            assert.strictEqual(preview(entry, e), -1, `entry #${i} after a valid one`);
        });

        [undefined, 'https://mega.io/', {url: 'https://mega.io/'}, 1].forEach((extra, i) => {
            assert.strictEqual(sanitize(RICH_PREVIEW, {extra}).metaType, -1, `extra #${i}`);
        });
        assert.strictEqual(sanitize(RICH_PREVIEW, undefined).metaType, -1, 'no meta');
    });

    it("validates geolocations", function() {
        assert.strictEqual(sanitize(GEOLOCATION, {extra: [{lng: '2.35', la: '48.85'}]}).metaType, GEOLOCATION);

        assert.strictEqual(sanitize(GEOLOCATION, {extra: [{lng: 2.35, la: 48.85}]}).metaType, GEOLOCATION);

        [
            undefined, [], [null], [0], ['x'], {0: {lng: 1, la: 2}}, [{}], [{la: '48.85'}], [{lng: '2.35'}]
        ].forEach((extra, i) => {
            assert.strictEqual(sanitize(GEOLOCATION, {extra}).metaType, -1, `extra #${i}`);
        });
        assert.strictEqual(sanitize(GEOLOCATION, undefined).metaType, -1, 'no meta');
    });

    it("validates giphies", function() {
        const giphy = (meta) => sanitize(GIPHY, meta).metaType;

        assert.strictEqual(giphy(gif), GIPHY);
        assert.strictEqual(giphy({src: 'giphy://a.mp4', s: 1, w: 2, h: 3}), GIPHY);

        [
            {...gif, src: undefined},
            {...gif, src: ['giphy://a.mp4']},
            {...gif, src_webp: {}},
            {...gif, s: {}},
            {...gif, s_webp: []},
            {...gif, w: {}},
            {...gif, h: [100]}
        ].forEach((meta, i) => {
            assert.strictEqual(giphy(meta), -1, `meta #${i}`);
        });
        assert.strictEqual(giphy(undefined), -1, 'no meta');
    });

    it("leaves unknown meta types alone", function() {
        const meta = {extra: 1};
        const msg = sanitize(-1, meta);
        assert.strictEqual(msg.metaType, -1);
        assert.strictEqual(msg.meta, meta);
    });

    it("only accepts a string textMessage", function() {
        var msg = sanitize(GIPHY, gif, 'a title');
        assert.strictEqual(msg.textContents, 'a title');
        assert.strictEqual(msg.messageHtml, 'hello');

        [['\0', '\x13'], {length: 1}, 1, null, false].forEach((textContents, i) => {
            msg = sanitize(GIPHY, gif, textContents);
            assert.strictEqual(msg.textContents, '', `textMessage #${i}`);
            assert.strictEqual(msg.messageHtml, '', `textMessage #${i}`);
        });
        msg = {metaType: GIPHY, meta: gif};
        Message.sanitize(msg);
        assert.strictEqual(msg.textContents, '', 'no textMessage');
    });

    it("sanitizes cached history", function() {
        var chatRoom = {messagesBuff: {}};
        var restore = (msgObject) => Message.fromPersistableObject(chatRoom, {msgId: 'x', userId: 'y', msgObject});
        var meta = {extra: [entry]};

        var msg = restore({textContents: 'hello', meta, metaType: RICH_PREVIEW});
        assert.strictEqual(msg.metaType, RICH_PREVIEW);
        assert.strictEqual(msg.meta, meta);
        assert.strictEqual(msg.textContents, 'hello');

        msg = restore({textContents: ['\0', '\x13'], meta: {extra: [{t: 'no url'}]}, metaType: RICH_PREVIEW});
        assert.strictEqual(msg.metaType, -1);
        assert.strictEqual(msg.textContents, '');

        msg = restore({textContents: 'here', meta: {}, metaType: GEOLOCATION});
        assert.strictEqual(msg.metaType, -1);
        assert.strictEqual(msg.textContents, 'here');

        msg = restore({textContents: 'plain text'});
        assert.strictEqual(msg.metaType, undefined);
        assert.strictEqual(msg.textContents, 'plain text');

        const shared = MANAGEMENT + CONTACT + JSON.stringify([contact]);
        msg = restore({textContents: shared});
        assert.strictEqual(msg.textContents, shared);

        msg = restore({textContents: MANAGEMENT + CONTACT + 'junk'});
        assert.strictEqual(msg.textContents, '');
    });
});
