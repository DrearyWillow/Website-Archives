import Papa from "papaparse"

const safeGet = (obj, ...keys) => {
    for (const key of keys) {
        if (typeof obj === "object" && obj !== null) {
            obj = obj[key]
        } else {
            return null
        }
    }
    return obj
}

const safeRequest = async (method, url, options = {}) => {
    try {
        const response = await fetch(url, {
            method: method.toUpperCase(),
            headers: options.headers || {},
            body: options.body ? JSON.stringify(options.body) : undefined,
        })
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`)
        }
        return await response.json()
    } catch (error) {
        console.error(`Error during fetch: ${error}`)
        return null
    }
}

const resolveHandle = async (handle) => {
    if (handle.startsWith("did:")) return handle
    if (handle.startsWith("@")) handle = handle.slice(1)
    const response = await safeRequest(
        "GET",
        `https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${handle}`
    )
    return response?.did || null
}

const getDidDoc = async (did) => {
    const url = did.startsWith("did:web:")
        ? `https://${did.split(":").pop()}/.well-known/did.json`
        : `https://plc.directory/${did}`
    return await safeRequest("GET", url)
}

const getServiceEndpoint = async (did) => {
    const doc = await getDidDoc(did)
    const services = doc?.service || []
    for (const service of services) {
        if (service.type === "AtprotoPersonalDataServer") {
            return service.serviceEndpoint
        }
    }
    console.warn("Defaulting to bsky.social")
    return "https://bsky.social"
}

const listRecords = async (did, endpoint, nsid) => {
    const api = `${endpoint}/xrpc/com.atproto.repo.listRecords`
    const params = new URLSearchParams({
        repo: did,
        collection: nsid,
        limit: 100,
    })
    const output = []
    let cursor
    do {
        if (cursor) params.set("cursor", cursor)
        const res = await safeRequest("GET", `${api}?${params.toString()}`)
        output.push(...(res.records || []))
        cursor = res.cursor
    } while (cursor)
    return output
}

const createRecord = async (did, endpoint, session, row, openLibKey) => {
    const timestamp = new Date().toISOString()
    const rating = Math.max(parseInt(row["My Rating"]) * 2, 1)
    const finishDate = row["Date Read"] || row["Date Added"] || timestamp

    const record = {
        "$type": "my.skylights.rel",
        item: { ref: "open-library", value: openLibKey },
        note: { value: row["My Review"], createdAt: timestamp, updatedAt: timestamp },
        rating: { value: rating, createdAt: timestamp },
        finishedAt: Array(parseInt(row["Read Count"]) || 1).fill(finishDate),
    }

    const payload = {
        repo: did,
        collection: "my.skylights.rel",
        record: record,
    }

    const headers = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.accessJwt}`,
    }

    const api = `${endpoint}/xrpc/com.atproto.repo.createRecord`
    const res = await safeRequest("POST", api, { headers, body: payload })
    if (res) {
        console.log(`Record created at: https://pdsls.dev/at/${res.uri.replace("at://", "")}`)
    }
}

const queryOpenLibrary = async (category, value = null, params = {}) => {
    const url = new URL(`https://openlibrary.org/${category}${value ? `/${value}` : ""}.json`)
    Object.keys(params).forEach((key) => url.searchParams.append(key, params[key]))

    console.log(`Query: ${url}`)
    return await safeRequest("GET", url.toString())
}

const retrieveKey = async (row) => {
    for (const isbnKey of ["ISBN13", "ISBN"]) {
        const isbn = row[isbnKey]?.replace(/^[="]|"$/g, "")
        if (!isbn) continue

        const result = await queryOpenLibrary("isbn", isbn)
        const key = result?.key
        if (key) {
            return key.split("/").pop()
        }
    }

    const cleanTitle = row["Title"].replace(/[\[\(].*?[\]\)]/g, "")
    const titleParts = cleanTitle.split(":")
    const params = {
        title: titleParts[0]?.trim(),
        subtitle: titleParts[1]?.trim() || "",
        author: row["Author"],
        id_goodreads: row["Book Id"],
        publisher: row["Publisher"],
        publish_year: row["Year Published"],
        first_publish_year: row["Original Publication Year"],
        q: "language:eng",
        fields: "key,editions,editions.key",
    }

    Object.keys(params).forEach((key) => {
        if (!params[key]) delete params[key]
    })

    let result = await queryOpenLibrary("search", null, params)
    if (!result || result.num_found === 0) {
        // Retry with loose criteria
        const retryParams = {
            title: params.title,
            author: params.author,
            q: params.q,
            fields: params.fields,
        }
        result = await queryOpenLibrary("search", null, retryParams)
        if (!result || result.num_found === 0) {
            return null
        }
    }

    const key = safeGet(result, "docs", 0, "editions", 0, "key")
    return typeof key === "string" ? key.split("/").pop() : null
}

const processCsv = async (csvFile, handle, password) => {
    const did = await resolveHandle(handle)
    if (!did) throw new Error("No DID found")

    const endpoint = await getServiceEndpoint(did)
    if (!endpoint) throw new Error("No service endpoint found")

    const session = await safeRequest("POST", `${endpoint}/xrpc/com.atproto.server.createSession`, {
        body: { identifier: handle, password },
    })
    if (!session) throw new Error("Session creation unsuccessful")

    const existingRecords = await listRecords(did, endpoint, "my.skylights.rel")
    const usedKeys = existingRecords.map((record) => safeGet(record, "value", "item", "value"))

    Papa.parse(csvFile, {
        header: true,
        complete: async ({ data }) => {
            for (const row of data) {
                if (!row["Read Count"] || parseInt(row["Read Count"]) <= 0) {
                    console.warn(`Skipping invalid or unread row: ${row.Title}`)
                    continue
                }

                const openLibKey = await retrieveKey(row)
                if (!openLibKey) {
                    console.warn(`No key found for: ${row.Title}`)
                    continue
                }

                if (usedKeys.includes(openLibKey)) {
                    console.warn(`Record already exists for: ${row.Title}`)
                    continue
                }

                await createRecord(did, endpoint, session, row, openLibKey)
            }
        },
    })
}

document.getElementById("importButton").addEventListener("click", function () {
    const handle = document.getElementById("handle").value
    const password = document.getElementById("password").value
    const fileInput = document.getElementById("csvFile")
    const csvFile = fileInput.files[0]
    if (!csvFile) {
        alert("Please select a CSV file.")
        return
    }
    processCsv(csvFile, handle, password)
})
