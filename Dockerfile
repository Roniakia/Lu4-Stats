FROM mcr.microsoft.com/playwright:v1.63.0-noble

ARG PUBLISHER_UID=1000
ARG PUBLISHER_GID=1000

USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends git openssh-client \
    && rm -rf /var/lib/apt/lists/* \
    && if [ "$(id -g pwuser)" != "${PUBLISHER_GID}" ]; then groupmod --gid "${PUBLISHER_GID}" pwuser; fi \
    && if [ "$(id -u pwuser)" != "${PUBLISHER_UID}" ]; then usermod --uid "${PUBLISHER_UID}" --gid "${PUBLISHER_GID}" pwuser; fi \
    && chown -R "${PUBLISHER_UID}:${PUBLISHER_GID}" /home/pwuser

ENV HOME=/home/pwuser
WORKDIR /home/pwuser/app

COPY --chown=${PUBLISHER_UID}:${PUBLISHER_GID} package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --chown=${PUBLISHER_UID}:${PUBLISHER_GID} . .

RUN mkdir -p /home/pwuser/.ssh \
    && chmod 700 /home/pwuser/.ssh \
    && chown "${PUBLISHER_UID}:${PUBLISHER_GID}" /home/pwuser/.ssh

USER pwuser
CMD ["node", "scheduler.js"]
