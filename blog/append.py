import os

#directory = os.fsencode("/home/kyler/Code/article/dir")
directory = os.fsencode("/mnt/Vault/Website/WebsiteRB/pdfs/postliterate")

f = open("/home/kyler/Code/article/output.txt","a")

for file in os.listdir(directory):
    filename = os.fsdecode(file)
    title = filename.replace(".pdf", "")
    title = title.replace("-", " ")
    #temp = '<p><a href="https://kyler.neocities.org/pdfs/postliterate/' + filename + '" target="_blank" rel="noopener noreferrer">' + title + '</a> - Postliterate</p>\n\n'
    temp = '<p><a href="https://kyler.neocities.org/pdfs/postliterate/' + filename + '" target="_blank" rel="noopener noreferrer">' + title + '</a></p>\n\n'
    #print(filename)
    #print(title)
    #print(temp)
    f.write(temp)

f.close()

