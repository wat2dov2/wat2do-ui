FROM public.ecr.aws/lambda/nodejs:22

WORKDIR ${LAMBDA_TASK_ROOT}

COPY social-preview/package.json social-preview/package-lock.json ./
RUN npm ci --omit=dev

COPY social-preview/handler.mjs ./handler.mjs
COPY backend/controlbox/social_previews.json ./social_previews.json

ENV SOCIAL_PREVIEW_CONTROL_PATH=${LAMBDA_TASK_ROOT}/social_previews.json

CMD ["handler.handler"]
