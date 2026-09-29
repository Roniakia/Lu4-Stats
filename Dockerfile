FROM mcr.microsoft.com/playwright:v1.63.0-noble

USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends git openssh-client gosu \
    && rm -rf /var/lib/apt/lists/*

ENV HOME=/home/pwuser
WORKDIR /home/pwuser/app

COPY --chown=pwuser:pwuser package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --chown=pwuser:pwuser . .
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
COPY github_known_hosts /etc/ssh/ssh_known_hosts

RUN chmod 755 /usr/local/bin/docker-entrypoint.sh \
    && chmod 644 /etc/ssh/ssh_known_hosts

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "scheduler.js"]
