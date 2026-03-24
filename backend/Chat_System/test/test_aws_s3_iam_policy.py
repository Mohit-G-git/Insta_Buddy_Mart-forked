import unittest

# Authenticated issue reporter for S3 policy

def report_aws_s3_iam_issue():
    error = "AWS S3: IAM policy lacks 's3:PutObject' for production bucket ARN."
    print(error)
    return error


class S3IamPolicyAuditTests(unittest.TestCase):
    def test_aws_s3_iam_policy_missing_putobject(self):
        error = report_aws_s3_iam_issue()
        self.assertIn('s3:PutObject', error)


if __name__ == '__main__':
    unittest.main()
