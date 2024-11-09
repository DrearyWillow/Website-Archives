

if (document.getElementById("timedPost")) {
    document.getElementById('timedPost').addEventListener('change', function() {
        document.getElementById('scheduleFields').style.display = this.checked ? 'block' : 'none';
    });
}

async function submitCreatePost(event) {
    event.preventDefault();

    const username = document.getElementById("username").value;
    const password = document.getElementById("password").value;
    const postText = document.getElementById("postText").value;
    const postUrl = document.getElementById("postUrl").value || null;
    const timedPost = document.getElementById("timedPost").checked;
    
    const year = document.getElementById("year").value || null;
    const month = document.getElementById("month").value || null;
    const day = document.getElementById("day").value || null;
    const hour = document.getElementById("hour").value || 0;
    const minute = document.getElementById("minute").value || 0;
    const second = document.getElementById("second").value || 0;

    try {
        const session = await createSession(username, password);
        const result = await createPost(postText, session, postUrl, timedPost, year, month, day, hour, minute, second);
        document.getElementById("result").textContent = result;
    } catch (error) {
        document.getElementById("result").textContent = `Error: ${error.message}`;
    }
}

async function submitGetJSON(event) {
    event.preventDefault();
    const postUrl = document.getElementById("postUrl").value || null;
    const replyMode = document.getElementById("replyMode").checked || false;
    const quoteMode = document.getElementById("quoteMode").checked || false;

    try {
        let result;
        if (quoteMode) {
            result = await getQuotes(await urlToUri(postUrl));
        } else {
            result = await getPostThread(await urlToUri(postUrl), replyMode);
        }
        document.getElementById("result").innerHTML = syntaxHighlight(JSON.stringify(result, null, 2));
    } catch (error) {
        document.getElementById("result").textContent = `Error: ${error.message}`;
    }
}

async function submitClout(event) {
    event.preventDefault();
    const postUrl = document.getElementById("postUrl").value || "";
    console.log(`POST URL (clout): ${postUrl}`)
    const cloutDict = {'likes': 0, 'reposts': 0, 'replies': 0, 'quotes': 0};
    try {
        await getClout((await getPostThread(await urlToUri(postUrl))).thread, cloutDict);
        let engagements = 0;
        let resultHtml = "";
        for (const key in cloutDict) {
            resultHtml += `${key}: ${cloutDict[key]}<br>`
            engagements += cloutDict[key];
        }
        resultHtml += `engagments: ${engagements}<br>`
        document.getElementById("result").innerHTML = resultHtml
    } catch (error) {
        document.getElementById("result").textContent = `Error: ${error.message}`;
    }
}

async function submitDid(event) {
    event.preventDefault();
    const postUrl = document.getElementById("postUrl").value || "";
    try {
        document.getElementById("result").innerHTML = await getDid(postUrl);
    } catch (error) {
        document.getElementById("result").textContent = `Error: ${error.message}`;
    }
}

async function submitUri(event) {
    event.preventDefault();
    const postUrl = document.getElementById("postUrl").value || "";
    try {
        document.getElementById("result").innerHTML = await urlToUri(postUrl);
    } catch (error) {
        document.getElementById("result").textContent = `Error: ${error.message}`;
    }
}

function syntaxHighlight(json) {
    if (typeof json !== 'string') {
        json = JSON.stringify(json, null, 4);
    }
    json = json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return json.replace(/("(\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g, function (match) {
        let cls = 'number';
        if (/^"/.test(match)) {
            cls = /:$/.test(match) ? 'key' : 'string';
        } else if (/true|false/.test(match)) {
            cls = 'boolean';
        } else if (/null/.test(match)) {
            cls = 'null';
        }
        return '<span class="' + cls + '">' + match + '</span>';
    });
}

async function urlToUri(postUrl) {
    console.log(`POST URL (url2uri): ${postUrl}`)
    const parts = postUrl.trim().replace(/\/$/, "").split('/');
    if (parts.length < 7) {throw new Error(`Post URL '${postUrl}' does not have enough segments.`)}
    return `at://${await resolveDid(parts[4])}/app.bsky.feed.post/${parts[6]}`;
}

async function resolveDid(handle) {
    if (handle.startsWith("did:")) {return handle}
    const response = await fetch(`https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${handle}`);
    if (!response.ok) {throw new Error(`Failed to resolve DID: ${await response.text()}`)}
    return (await response.json()).did;
}

async function serviceEndpoint(did) {
    let response;
    if (did.startsWith(`did:plc`)) {
        console.log("did:plc")
        response = await fetch(`https://plc.directory/${did}`);
    } else {
        console.log(`did:web`)
        response = await fetch(`https://${did}/.well-known/did.json`);
    }
    console.log(`${did}`)
    if (!response.ok) {throw new Error(`Failed to retrieve service endpoint: ${await response.text()}`)}
    services = (await response.json()).service;
    for (const service of services) {
        if (service.type === "AtprotoPersonalDataServer") {
            return service.serviceEndpoint;
        }
    }
    throw new Error(`PDS serviceEndpoint not found in DID document`);
}

async function createSession(username, password) {
    const response = await fetch(`https://public.api.bsky.app/xrpc/com.atproto.server.createSession`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 'identifier': username, 'password': password })
    });

    if (!response.ok) {
        throw new Error(`Failed to create session: ${await response.text()}`);
    }

    return await response.json();
}

async function createPost(text, session, parentUrl, timedPost, year, month, day, hour = 0, minute = 0, second = 0) {
    const did = session.did;
    const serviceEndpoint = await serviceEndpoint(did);
    const url = `${serviceEndpoint}/xrpc/com/atproto.repo.createRecord`;

    let timestamp;

    if (!timedPost || (!year && !month && !day && !hour && !minute && !second)) {
        timestamp = new Date().toISOString();
    } else if (year && month && day) {
        const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
        timestamp = date.toISOString();
    } else {
        throw new Error('Please provide at least a year, month, and day');
    }

    const post = {
        "$type": "app.bsky.feed.post",
        "text": text,
        "createdAt": timestamp
    };

    if (parentUrl) {
        const pdata = await getPostThread(await urlToUri(postUrl));
        post.reply = {
            "parent": {
                "cid": pdata.post.cid,
                "uri": pdata.post.uri
            },
            "root": {
                "cid": pdata.post.record.reply.root.cid,
                "uri": pdata.post.record.reply.root.uri
            }
        };
    }

    const payload = JSON.stringify({
        "repo": did,
        "collection": "app.bsky.feed.post",
        "validate": true,
        "record": post
    });

    const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': session.accessJwt
    };

    const response = await fetch(url, {
        method: 'POST',
        headers: headers,
        body: payload
    });

    if (!response.ok) {
        throw new Error(`Failed to create post. Status code: ${response.status}. Response: ${await response.text()}`);
    }

    const rkey = (await response.json()).uri.split('/').pop();
    return `Post created successfully: <a href="https://bsky.app/profile/${session.handle}/post/${rkey}">https://bsky.app/profile/${session.handle}/post/${rkey}</a>`;
}

async function getQuotes(atUri) {
    console.log(`AT URI (getQuotes): ${atUri}`)
    const params = new URLSearchParams({
        uri: atUri,
        limit: '100'
    });
    const response = await fetch(`https://public.api.bsky.app/xrpc/app.bsky.feed.getQuotes?${params}`, {headers: {'Content-Type': 'application/json'}});
    if (!response.ok) {throw new Error(`Failed to retrieve post quotes: ${await response.text()}`)}
    return await response.json();
}

async function getDid(input) {
if (input.includes("/")) {
    const parts = input.split('/');
    if (parts.length < 5) {
        throw new Error(`URL does not have enough segments.`);
    }
    return await resolveDid(parts[4]);
} else {
    return await resolveDid(input);
}
}

async function getPostThread(atUri, replyMode = false) {
    console.log(`AT URI (getPostThread): ${atUri}`)
    const params = new URLSearchParams({
        uri: atUri,
        depth: replyMode ? '6' : '0',
        parentHeight: replyMode ? '8' : '0'
    });
    const response = await fetch(`https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread?${params}`, {headers: {'Content-Type': 'application/json'}});
    if (!response.ok) {throw new Error(`Failed to retrieve post thread: ${await response.text()}`)}
    return await response.json();
}

async function getClout(threadNode, cloutDict) {
    const post = threadNode.post
    if (post) {
        cloutDict.likes += post.likeCount
        cloutDict.reposts += post.repostCount
    }
    if (threadNode.replies) {
        for (const reply in threadNode.replies) {
            cloutDict.replies += 1;
            await getClout(reply, cloutDict);
        }
    }
    const quotes = (await getQuotes(post.uri)).posts
    for (const quote of quotes) {
        cloutDict.quotes += 1;
        await getClout((await getPostThread(quote.uri)).thread, cloutDict);
    }
}
    
