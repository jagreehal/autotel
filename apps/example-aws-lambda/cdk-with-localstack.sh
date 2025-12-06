#!/bin/bash
# Use regular CDK with LocalStack endpoints (bypass cdklocal)
# This approach is more reliable than cdklocal for modern CDK versions

# Set LocalStack endpoints for all AWS services
export AWS_ENDPOINT_URL_CLOUDFORMATION="http://localhost:4566"
export AWS_ENDPOINT_URL_CLOUDWATCH="http://localhost:4566"
export AWS_ENDPOINT_URL_DYNAMODB="http://localhost:4566"
export AWS_ENDPOINT_URL_EVENTS="http://localhost:4566"
export AWS_ENDPOINT_URL_IAM="http://localhost:4566"
export AWS_ENDPOINT_URL_LAMBDA="http://localhost:4566"
export AWS_ENDPOINT_URL_LOGS="http://localhost:4566"
export AWS_ENDPOINT_URL_S3="http://s3.localhost.localstack.cloud:4566"
export AWS_ENDPOINT_URL_SQS="http://localhost:4566"
export AWS_ENDPOINT_URL_SSM="http://localhost:4566"
export AWS_ENDPOINT_URL_STS="http://localhost:4566"

# Set credentials for LocalStack
export AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-test}"
export AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-test}"

# Set default region if not already set
export AWS_REGION="${AWS_REGION:-us-east-1}"
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-us-east-1}"
export CDK_DEFAULT_REGION="${CDK_DEFAULT_REGION:-us-east-1}"
export CDK_DEFAULT_ACCOUNT="${CDK_DEFAULT_ACCOUNT:-000000000000}"

# Run regular CDK with all arguments
exec cdk "$@"
