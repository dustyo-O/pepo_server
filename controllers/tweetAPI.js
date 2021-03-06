'use strict';

var mongoose = require('mongoose');
var Tweet = require('../models/tweet').Tweet;
var User = require('../models/user').User;
//var userFilter = require('./user');
var parseTweet = require('./users').parseTweet;
var images = require('./images');

var Encoder = (new (require('node-html-encoder').Encoder)('entity'));
var encode = ( Encoder.htmlEncode.bind(Encoder) );

function prefixOuterURL(url) {
    var re = /^https?:\/\//;
    if (!(re.test(url))) {
        url = 'http://' + url;
    }
    return url; //encodeURI(url);
}

function createTwit(user, base, cb ) {
    var b = {
        author: user._id,
        content: encode(base.content),
        extras: { }
    };

    var t = ['commentedTweetId', 'geo', 'url', 'parentTweetId', 'image', 'attachment'];
    /*eslint-disable no-unexpected-multiline,no-sequences */
    t.forEach((item) => {
        if (base[item]) {
            b.extras[item] = base[item];
        } else if (base.extras && base.extras[item]) {
            b.extras[item] = base.extras[item];
        }

    });

    if (b.extras.url) {
        b.extras.url = prefixOuterURL(b.extras.url);
    }

    if (b.extras.image) {
        images.commitFile(b.extras.image, (err)=>{
            if (!err) {
                console.log('Error while commiting image:', err);
            }
        });
    }
    if (b.extras.attachment) {
        images.commitFile(b.extras.attachment, (err, att)=>{
            if ((att) && (!err)) {
                b.extras.attachment = {
                    url: att.target,
                    image: att.url,
                    title: att.title
                };
                cb(null, new Tweet(b));
            } else {
                if (!err) {
                    err = 'Attachment not found';
                }
                cb(err);
            }
        });
    } else {
        setImmediate( () => {
            cb(null, new Tweet(b));
        });
    }

}

function setTweet(req, res, next) {
    User.findOne({
        $and: [
            {socialNetworkId: req.user.socialNetworkId},
            {provider: req.user.provider}
        ]}, (err, user) => {
        if (!User.isUser(req, res, err, user, next)) {
            return;
        }

        createTwit(user, req.body, (err1, tweet) => {
            if (err1) {
                return next(err1);
            }
            tweet.save(function (err) {
                if (err) {
                    return next(err);
                } else {
                    parseTweet(tweet, next, (o) => {
                        res.status(200).json(o);
                    }, user);
                }
            });
        });

    });
}

function reTweet(req, res, next) {
    var parentTweetId = req.params.id;

    if (!mongoose.Types.ObjectId.isValid(parentTweetId)) {
        return res.status(404).json({status: 'Tweet not found'});
    }

    User.findOne({
        $and: [
            {socialNetworkId: req.user.socialNetworkId},
            {provider: req.user.provider}
        ]}, (err, user) => {

        if (!User.isUser(req, res, err, user, next)) {
            return;
        }

        Tweet.findById(parentTweetId)
            .exec((err, parentTweet) => {
                if (err) {
                    return next(err);
                }

                if (!parentTweet) {
                    return res.status(404).json({status: 'Tweet not found'});
                }

                var isRetweet = parentTweet.extras.retweets.some(x => x.toString() === user._id.toString());

                if (!isRetweet) {
                    req.body.parentTweetId = parentTweetId;

                    createTwit(user, req.body, (err1, tweet) => {
                        if (err1) {
                            return next(err1);
                        }

                        tweet.save(function (err) {
                            if (err) {
                                console.log('Error while saving tweet: ', err);
                            }
                        });
                    });

                    parentTweet.extras.retweets.push(user._id);
                    parentTweet.save(function (err) {
                        if (err) {
                            return next(err);
                        }
                        Tweet.find({_id: parentTweetId}).exec((err1, newTweet) => {
                            if (err1) {
                                return next(err1);
                            } else {
                                parseTweet(newTweet, next, (o) => {
                                    res.status(200).json(o);
                                }, user);
                            }
                        });
                    });
                } else {
                    res.status(200).json({status: 'Already retweeted'});
                }
            });
    });
}

function commentTweet(req, res, next) {
    var commentedTweetId = req.params.id;

    if (!mongoose.Types.ObjectId.isValid(commentedTweetId)) {
        return res.status(404).json({status: 'Tweet not found'});
    }

    User.findOne({
        $and: [
            {socialNetworkId: req.user.socialNetworkId},
            {provider: req.user.provider}
        ]}, (err, user) => {
        if (!User.isUser(req, res, err, user, next)) {
            return;
        }

        Tweet.findById(commentedTweetId)
        .exec((err, commentedTweet) => {
            if (err) {
                return next(err);
            }

            if (!commentedTweet) {
                return res.status(404).json({status: 'Tweet not found'});
            }

            req.body.commentedTweetId = commentedTweetId;

            createTwit(user, req.body, (err1, tweet) => {
                if (err1) {
                    return next(err1);
                }

                tweet.save(function (err) {
                    if (err) {
                        return next(err);
                    } else {
                        parseTweet(tweet, next, (o) => {
                            res.status(200).json(o);
                        }, user);
                    }
                });

                commentedTweet.extras.comments.push(tweet._id);
                commentedTweet.save(function (err) {
                    if (err) {
                        return next(err);
                    }
                });
            });
        });
    });
}

function getComments(req, res, next) {
    var commentedTweetId = req.params.id;

    if (!mongoose.Types.ObjectId.isValid(commentedTweetId)) {
        return res.status(404).json({status: 'Tweet not found'});
    }

    Tweet.findById(commentedTweetId)
        .exec((err, commentedTweet) => {
            if (err) {
                return next(err);
            }

            if (!commentedTweet) {
                return res.status(404).json({status: 'Tweet not found'});
            }

            var comments = commentedTweet.extras.comments;

            if (req.query.offset) {
                Tweet.find({
                    $and: [
                        {_id: {$in: comments}},
                        {'extras.commentedTweetId': {$exists: true}},
                        {timestamp: {$gte: req.query.offset}}
                    ]
                })
                .sort({timestamp: 1})
                .limit(req.query.limit > 50 ? 50 : ((Number(req.query.limit) || 10)))
                .exec((err, tweets) => {
                    if (err) {
                        return next(err);
                    } else {
                        parseTweet(tweets, next, (o) => {
                            res.status(200).json(o);
                        });
                    }
                });
            } else {
                Tweet.find({
                    $and: [
                        {_id: {$in: comments}},
                        {'extras.commentedTweetId': {$exists: true}}
                    ]
                })
                .sort({timestamp: 1})
                .limit(req.query.limit > 50 ? 50 : ((Number(req.query.limit) || 10)))
                .exec((err, tweets) => {

                    if (err) {
                        return next(err);
                    } else {
                        parseTweet(tweets, next, (o) => {
                            res.status(200).json(o);
                        });
                    }
                });
            }

        });
}

function getTweets(req, res, next) {
    if (!req.params.login) {
        User.getByReq(req, res, next, (q)=>{
            q.populate('follows');
        }).then((user) => {
            var userFollows = user.follows.map(follower => follower._id);
            userFollows.push(user._id);

            if (req.query.offset) {
                Tweet.find({
                    $and: [
                        {author: {$in: userFollows}},
                        {'extras.commentedTweetId': {$exists: false}},
                        {timestamp: {$gte: req.query.offset}}
                    ]
                })
                .sort({timestamp: -1})
                .limit(req.query.limit > 50 ? 50 : ((Number(req.query.limit) || 10)))
                .exec((err, tweets) => {
                    if (err) {
                        return next(err);
                    } else {
                        parseTweet(tweets, next, (o) => {
                            res.status(200).json(o);
                        }, user);
                    }
                });
            } else {
                Tweet.find({
                    $and: [
                        {author: {$in: userFollows}},
                        {'extras.commentedTweetId': {$exists: false}}
                    ]
                })
                .sort({timestamp: -1})
                .limit(req.query.limit > 50 ? 50 : ((Number(req.query.limit) || 10)))
                .exec((err, tweets) => {
                    if (err) {
                        return next(err);
                    } else {
                        parseTweet(tweets, next, (o) => {
                            res.status(200).json(o);
                        }, user);
                    }
                });
            }
        });
    } else if (req.params.login) {
        User.findOne({displayName: req.params.login})
            .exec((err, user) => {
                console.log('user', user);
                Tweet.find({
                    $and: [
                        {author: user._id},
                        {'extras.commentedTweetId': {$exists: false}}
                    ]
                })
                .sort({timestamp: -1})
                .limit(50)
                .exec((err, tweets) => {
                    if (err) {
                        return next(err);
                    } else {
                        parseTweet(tweets, next, (o) => {
                            res.status(200).json(o);
                        }, user);
                    }
                });
            });
    } else {
        res.status(200).json({status: 'error'});
    }
}

function getHistory(req, res, next) {
    if (!req.params.login) {
        User.getByReq(req, res, next, (q)=>{
            q.populate('follows');
        }).then((user) => {
            var userFollows = user.follows.map(follower => follower._id);
            userFollows.push(user._id);

            if (req.query.offset) {
                Tweet.find({
                    $and: [
                    {author: {$in: userFollows}},
                    {'extras.commentedTweetId': {$exists: false}},
                    {timestamp: {$lt: req.query.offset}}
                    ]
                })
                .sort({timestamp: -1})
                .limit(req.query.limit > 50 ? 50 : ((Number(req.query.limit) || 10)))
                .exec((err, tweets) => {
                    if (err) {
                        return next(err);
                    } else {
                        parseTweet(tweets, next, (o) => {
                            res.status(200).json(o);
                        }, user);
                    }
                });
            } else {
                Tweet.find({
                    $and: [
                    {author: {$in: userFollows}},
                    {'extras.commentedTweetId': {$exists: false}}
                    ]
                })
                .sort({timestamp: -1})
                .limit(req.query.limit > 50 ? 50 : ((Number(req.query.limit) || 10)))
                .exec((err, tweets) => {
                    if (err) {
                        return next(err);
                    } else {
                        parseTweet(tweets, next, (o) => {
                            res.status(200).json(o);
                        }, user);
                    }
                });
            }
        });
    }
}

function getTweet(req, res, next) {
    var tweetId = req.params.id;

    if (!mongoose.Types.ObjectId.isValid(tweetId)) {
        return res.status(404).json({status: 'Tweet not found'});
    }
    User.findOne({
        $and: [
            {socialNetworkId: req.user.socialNetworkId},
            {provider: req.user.provider}
        ]
    })
        .exec((err, user) => {
            Tweet.findOne({
                $and: [
                    {_id: tweetId},
                    {'extras.commentedTweetId': {$exists: false}}
                ]
            })
            .where('extras.comments').slice(10)
            .populate('extras.parentTweetId extras.comments')
            .exec((err, tweet) => {
                if (err) {
                    return next(err);
                }

                if (!tweet) {
                    return res.status(404).json({status: 'Tweet not found'});
                }

                parseTweet(tweet, next, (o) => {
                    res.status(200).json(o);
                }, user);

            });
        });
}

function likeTweet(req, res, next) {
    var likeTweetId = req.params.id;

    if (!mongoose.Types.ObjectId.isValid(likeTweetId)) {
        return res.status(404).json({status: 'Tweet not found'});
    }

    User.findOne({
        $and: [
            {socialNetworkId: req.user.socialNetworkId},
            {provider: req.user.provider}
        ]}, (err, user) => {
        if (!User.isUser(req, res, err, user, next)) {
            return;
        }

        Tweet.findById(likeTweetId)
            .exec((err, tweet) => {
                if (err) {
                    return next(err);
                }

                if (!tweet) {
                    return res.status(404).json({status: 'Tweet not found'});
                }

                var index = tweet.extras.likes.indexOf(user._id);

                if (req.method === 'POST' && (index === -1)) {
                    tweet.extras.likes.push(user._id);

                    tweet.save(function (err) {
                        if (err) {
                            return next(err);
                        }

                        parseTweet(tweet, next, (o) => {
                            res.status(200).json(o);
                        }, user);

                    });
                } else if (req.method === 'DELETE' && !(index === -1)) {
                    tweet.extras.likes.splice(index, 1);
                    tweet.save(function (err) {
                        if (err) {
                            return next(err);
                        }

                        parseTweet(tweet, next, (o) => {
                            res.status(200).json(o);
                        }, user);
                    });
                } else {
                    parseTweet(tweet, next, (o) => {
                        res.status(200).json(o);
                    }, user);
                }

            });
    });
}

function deleteTweet(req, res, next) {
    var deleteTweetId = req.params.id;

    if (!mongoose.Types.ObjectId.isValid(deleteTweetId)) {
        return res.status(404).json({status: 'Tweet not found'});
    }

    User.findOne({
        $and: [
            {socialNetworkId: req.user.socialNetworkId},
            {provider: req.user.provider}
        ]}, (err, user) => {
        if (!User.isUser(req, res, err, user, next)) {
            return;
        }

        Tweet.findByIdAndRemove(deleteTweetId)
            .where('author', user._id)
            .exec((err, tweet) => {
                if (err) {
                    return next(err);
                }

                if (!tweet) {
                    return res.status(404).json({status: 'Tweet not found'});
                }

                parseTweet(tweet, next, (o) => {
                    res.status(200).json(o);
                }, user);
            });
    });
}

function deleteReTweet(req, res, next) {
    var tweetId = req.params.id;

    if (!mongoose.Types.ObjectId.isValid(tweetId)) {
        return res.status(404).json({status: 'Tweet not found'});
    }

    User.findOne({
        $and: [
            {socialNetworkId: req.user.socialNetworkId},
            {provider: req.user.provider}
        ]}, (err, user) => {

        if (!User.isUser(req, res, err, user, next)) {
            return;
        }

        Tweet.findById(tweetId)
            .exec((err, parentTweet) => {
                if (err) {
                    return next(err);
                }

                if (!parentTweet) {
                    return res.status(404).json({status: 'Tweet not found'});
                }

                Tweet.find({
                    $and: [
                        {author: user._id},
                        {'extras.parentTweetId': tweetId}
                    ]})
                    .remove()
                    .exec((err) => {
                        if (err) {
                            return next(err);
                        }

                        var index = parentTweet.extras.retweets.indexOf(user._id);

                        if (index !== -1) {
                            parentTweet.extras.retweets.splice(index, 1);
                            parentTweet.save(function (err) {
                                if (err) {
                                    return next(err);
                                }

                                parseTweet(parentTweet, next, (o) => {
                                    res.status(200).json(o);
                                }, user);
                            });
                        } else {
                            parseTweet(parentTweet, next, (o) => {
                                res.status(200).json(o);
                            }, user);
                        }

                    });
            });
    });
}
/*
function parseTweet(tweets, next, cb, user) {
    var users = {};
    if (!(tweets instanceof Array)) {
        tweets = [tweets];
    }

    tweets = tweets.map(x => {
        var isLiked;
        var isRetweeted;
        var tweet = x.toJSON();
        users[tweet.author] = null;

        if (user && tweet.extras) {
            if (tweet.extras.likes) {
                isLiked = tweet.extras.likes.some(x => x.toString() === user._id.toString());
            }
            if (tweet.extras.retweets) {
                isRetweeted = tweet.extras.retweets.some(x => (x.toString() === user._id.toString()) );
            }

            tweet.like = isLiked;
            tweet.retweet = isRetweeted;
        } else {
            if (!(tweet.extras)) {
                tweet.extras = {};
            }
        }

        return tweet;
    });

    User.find({_id: {$in: Object.keys(users)}})
        .exec((err, authors) => {
            if (err) {
                return next(err);
            }

            authors.forEach(u => {
                users[u._id] = userFilter.userToData(u);
            });

            cb( {tweets: tweets, users: users} );
        });
}
*/
module.exports = {
    setTweet,
    reTweet,
    commentTweet,
    getComments,
    getTweets,
    getHistory,
    getTweet,
    likeTweet,
    deleteTweet,
    deleteReTweet
};
